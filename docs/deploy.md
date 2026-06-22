# Running & deploying

Three deployable pieces:

| Piece    | Where it runs                          | How                       |
| -------- | -------------------------------------- | ------------------------- |
| API      | server                                 | `docker compose` (prod)   |
| Web      | server                                 | (TanStack Start / Vinxi)  |
| Agent    | the machine physically wired to the printer | Bun, native (USB access) |

## Dev (local, as before)

The app runs natively with Bun; only Postgres comes from Docker.

```sh
cp apps/agent/.env.example apps/agent/.env   # one-time: set a DEV API_KEY
bun run dev                                  # Postgres + api :5801 + web :5800 + agent
```

`bun run dev` brings up the dev Postgres (and waits for it to be healthy) before
starting everything, so there's no way to run the app without its database. The dev
agent starts too — it prints for real but with `PRINTER_PRIORITY=low`, so it yields to
the persistent prod daemon. Its `SERVER_URL` (dev API on :5801) and `API_KEY` come from
`apps/agent/.env`, which Bun autoloads; without that file the agent panel exits with
"API_KEY required" while api/web keep running.

`bun run db:down` stops the dev Postgres when you're done.

Dev ports use a project-specific `58xx` range (web `5800`, api `5801`, Postgres `5802`)
so they don't collide with common defaults — a system Postgres on 5432, another
project's dev DB on 5433, or a web app on 3000. Dev Postgres lives in its own volume
(`printer-dev` project).

## Prod (the real one)

Self-contained stack — Postgres + API. Postgres is **not** published to the host.

```sh
cp .env.prod.example .env.prod      # fill in POSTGRES_PASSWORD, ADMIN_API_KEY, CORS_ORIGIN
docker compose --env-file .env.prod up -d --build
```

Runs under the `printer-prod` project with its own `printer-pgdata` volume —
fully isolated from dev. API on :5810.

## Agent (the printer machine)

The agent talks to the POS-58 over **USB**, so it runs natively with Bun (no Docker —
USB passthrough is unreliable/unsupported there). It only needs network to the API
and the printer plugged in.

```sh
SERVER_URL=https://api.printer.example.com API_KEY=YOUR_AGENT_KEY bun apps/agent/src/index.ts
```

- `SERVER_URL` — the public API URL (the agent rewrites `http→ws` itself).
- `API_KEY` — a service key the agent authenticates with.
- Add `DRY_RUN=true` to simulate printing without hardware.

### Two agents, one printer

Multiple agents can share a single physical printer (e.g. a prod daemon on the real
API plus a dev agent on the local API). They serialize USB access with a cross-process
`flock(2)` lock, so concurrent jobs **take turns** instead of colliding — no `BUSY`
errors, no partial/duplicate prints. The kernel releases the lock automatically when
an agent exits or crashes, so a killed print never strands the printer, and a long
print is never falsely interrupted. If a job can't get the printer within the timeout
it's requeued (not failed).

**Priority** — by default every agent is `high` and takes turns first-come. The
persistent/prod daemon stays `high`; the dev agent started by `bun run dev` uses
`PRINTER_PRIORITY=low`, so it always yields to prod. When both are waiting, prod goes
first; a print already in progress is never preempted (that would tear a receipt) —
priority only decides who goes next.

Tunable via env: `PRINTER_PRIORITY` (`high`/`low`), `PRINTER_LOCK_PATH`,
`PRINTER_LOCK_TIMEOUT_MS` (default 60s). The default lock path lives in the repo so
both a root daemon and a user-level agent can open it.

### Keep it always-on (macOS / launchd)

A `LaunchDaemon` starts the agent at boot (no login needed) and restarts it if it
crashes (`KeepAlive`, 10s throttle). Managed by bun scripts from `apps/agent`.

One-time: create the local config from the template.

```sh
cp apps/agent/agent.env.example apps/agent/agent.env   # edit SERVER_URL + API_KEY (gitignored)
```

Then, from the repo root:

```sh
# Start + keep alive (copies agent.env → /usr/local/etc, installs plist, loads on boot)
bun run agent:start

# Restart with current config (re-copies agent.env, kickstarts the daemon)
bun run agent:restart

# Stop and disable (stays off across reboots — KeepAlive won't resurrect it)
bun run agent:stop
```

(Inside `apps/agent` the same commands are `bun run daemon:start|stop|restart`.)

Each runs `sudo` internally (copying into `/Library/LaunchDaemons` and `/usr/local/etc`),
so it'll prompt for your password. Logs: `tail -f /var/log/printer-agent.log`.

> Why `daemon:stop` and not `kill`: with `KeepAlive=true`, killing the process just makes
> launchd relaunch it. `daemon:stop` unloads + disables it, so it stays down until `daemon:start`.

To uninstall completely: `bun run daemon:stop`, then delete
`/Library/LaunchDaemons/com.printer.agent.plist` and `/usr/local/etc/printer-agent.env`.

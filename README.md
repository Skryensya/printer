# Printer

A thermal printer on my desk that anyone on the internet can print to.

It started from a question that wouldn't leave me alone: what if anything on the web could print
on it? The answer is a small API that turns print requests into jobs, an agent that delivers them
to the printer over USB, and a public front-end, [Ping](https://ping.allison.sh), where a stranger
can send one short message and watch it come out on paper.

Letting strangers reach physical hardware is mostly a problem of restraint, so most of the code is
about limits: per-key quotas, a per-visitor cooldown, a queue that smooths bursts, and a front-end
that throttles itself to whatever budget the API reports.

## Layout

| Piece | Where | What it does |
| ----- | ----- | ------------ |
| API   | `apps/api`   | Receives print requests, queues them as jobs, enforces quotas. |
| Agent | `apps/agent` | Runs on the machine wired to the printer and prints queued jobs. |
| Web   | `apps/web`   | Admin console and API docs. |
| Ping  | `apps/wall`  | The public message front-end (packaged as `wall` for historical reasons). |

The domain language lives in [`CONTEXT-MAP.md`](./CONTEXT-MAP.md); decisions are in
[`docs/adr`](./docs/adr).

## Running it

Needs [Bun](https://bun.com), pnpm and Docker (for Postgres).

```sh
cp apps/agent/.env.example apps/agent/.env   # set a dev API_KEY
bun run dev                                  # Postgres + api :5801 + web :5800 + agent
```

Set `DRY_RUN=true` in the agent's `.env` to simulate printing without a printer. See
[`docs/deploy.md`](./docs/deploy.md) for the production setup.

## License

MIT

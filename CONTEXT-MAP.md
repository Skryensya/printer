# Context Map

The repo has two bounded contexts: the **Printer API** (the service, agent, and
admin console that turn print requests into paper) and **Ping** (the public,
abuse-resistant front-end at `ping.allison.sh` that lets strangers send one
message to the printer).

> Naming note: the Ping context ships from the `apps/wall` directory and the
> `@printer/wall` package. That packaging name is retained for continuity; the
> product, UI, and domain language are **Ping**. Nothing user-facing says "wall".

## Contexts

- [Printer API](./CONTEXT.md) — receives print requests, queues them as Jobs, and
  delivers them to the physical printer via the Agent. Lives in `apps/api`,
  `apps/agent`, and `packages/core`.
- [Ping](./apps/wall/CONTEXT.md) — public message front-end at `ping.allison.sh`.
  Accepts one short message per Visitor, smooths bursts, and forwards them to the
  Printer API. Lives in `apps/wall`.

## Relationships

- **Ping → Printer API** (customer / supplier): Ping is just another caller. It
  holds one Service Key with `message` permission and POSTs to
  `/api/v1/print/message`. The API has no knowledge of Ping.
- **Ping ⇒ Job**: a Ping, once forwarded, becomes a Job in the API. Ping stores
  the returned Job id but does not track the Job's lifecycle.
- **Budget mirrors Quota State**: Ping learns the API's remaining Quota from the
  `X-RateLimit-*` response headers and throttles itself to it. The API's Quota is
  the source of truth; Ping's Budget is a cached shadow of it.

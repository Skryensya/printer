# REST API conventions

HTTP status codes are the machine-readable signal. Response bodies carry data and human-readable context — never a redundant `ok` boolean or error-type string.

## Decisions

### No `ok` envelope

All responses drop the `{ ok: boolean }` wrapper. Clients check `res.ok` (or the numeric status) to detect success or failure. Error bodies are `{ error: string }` where `error` is always a human-readable message, never a machine code duplicating the status.

Extra fields on specific statuses are allowed when they give callers actionable context:
- **403**: `{ error, type, allowed }` — which type was attempted and what is allowed
- **429**: `{ error, exceeded, retry_after }` — which window was exceeded and when to retry

### 204 No Content for mutations with no return value

`PATCH`, `POST` action endpoints (`/retry`, `/cancel`, `/revoke`), and `DELETE` that produce no meaningful body return 204 with an empty body. Clients must not attempt to parse the response body on 204.

### 202 Accepted + `Location` for async print jobs

Print endpoints return `202 Accepted` with `{ id }` and a `Location: /api/v1/jobs/:id` header pointing to the job resource. Callers can poll that URL to confirm completion.

### Action URLs kept as-is

`POST /api/v1/jobs/:id/retry`, `POST /api/v1/jobs/:id/cancel`, and `POST /api/v1/keys/:id/revoke` use verb-in-URL style. These were not converted to `PATCH` because:
- The state transitions are not idempotent
- `revoke` and `delete` are distinct operations (revoke keeps the record for audit; delete removes it)
- Mapping them to PATCH would require the server to validate the transition anyway

### `"todo"` is a distinct permission type

`/api/v1/print/todo` requires the `"todo"` permission, not `"ticket"`, even though todo prints as a ticket internally. The permission layer is an API-surface concept, not a job-type concept. Conflating them produces confusing `type_not_allowed` errors that reference a type the caller never mentioned.

### `GET /api/v1/jobs/:id` is source-scoped for service keys

Service keys can only retrieve jobs where `job.source === key.name`. A request for a job that exists but belongs to another source returns 404 — not 403 — to avoid revealing that the job exists. Admin keys bypass the filter and can read any job.

### `/health` is unauthenticated

`GET /health` requires no key. It returns only `{ service: "printer-api" }` and is safe for load balancers and uptime monitors. The agent status endpoint (`GET /api/v1/agent`) is more sensitive and remains admin-gated.

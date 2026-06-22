# Printer API

A self-hosted HTTP service that receives print requests from external callers, queues them as Jobs, and delivers them to a physical thermal printer via a long-running Agent process.

## Language

### Core

**Job**: A single unit of print work. Has a type (text, ticket, qr, barcode, image, borders, test), a JSON payload, and a status lifecycle (pending → printing → done | failed | cancelled).
_Avoid_: task, request, print request

**Agent**: The process that runs on the machine physically connected to the printer. Connects to the API via WebSocket, receives Jobs, and executes them against the hardware.
_Avoid_: worker, printer process, client

**Watcher**: A WebSocket client that observes Job lifecycle events in real time. The web UI is the only Watcher today.
_Avoid_: observer, subscriber, monitor

**Source**: The name of the Service Key that enqueued a Job. Stored on the Job for attribution. Not a user identity — keys are named by the admin.
_Avoid_: user, caller, origin

### Auth

**Service Key**: A credential issued to an external caller that authorizes enqueuing Jobs. Stored hashed in Postgres. May carry a Quota.
_Avoid_: API key, user key, client key

**Admin Key**: A single shared secret set via the `ADMIN_API_KEY` environment variable. Authorizes key management and job inspection. Not stored in the database.
_Avoid_: master key, superkey, root key

### Rate limiting

**Quota**: The rate limits attached to a Service Key — a per-minute cap and a per-day cap. Either cap may be null, meaning unlimited for that window. A key with no Quota (both null) is unrestricted.
_Avoid_: rate limit, throttle config, limits

**Minute Window**: A sliding 60-second window used to enforce the per-minute cap. Tracked in memory; resets organically as requests age out.
_Avoid_: per-minute bucket, minute slot

**Day Window**: A fixed UTC calendar day (midnight-to-midnight) used to enforce the per-day cap. Tracked in Postgres so it survives server restarts.
_Avoid_: daily bucket, 24h window, daily slot

**Quota State**: The snapshot of a key's current usage and remaining capacity for both windows at the moment of a request. Returned to callers as response headers on every authenticated response.
_Avoid_: rate limit headers, usage info, throttle state

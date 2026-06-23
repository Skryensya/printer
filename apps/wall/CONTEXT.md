# Ping

The public front-end at `ping.allison.sh` that lets anyone on the internet send
one short message — a *ping* — to the physical printer. It is a downstream client
of the Printer API: it accepts and smooths pings, then forwards them as `message`
Jobs.

> Ships from `apps/wall` / `@printer/wall` (packaging name kept for continuity).
> The product and its language are Ping; nothing user-facing says "wall".

## Language

**Ping**:
One short message a Visitor or Member sends, held in Ping's queue until it is
forwarded to the Printer API. Carries the originating IP (never shown to clients).
Once forwarded it points to the Job the API created. "Ping" also names the
product/site as a whole.
_Avoid_: submission, post, message, job, entry, tweet, wall

**Visitor**:
An anonymous member of the public, identified by client IP — the full IPv4
address, or the /64 prefix for IPv6 — read from one trusted proxy hop. Subject to
the Cooldown and the bot traps. Has no account. Not a real identity boundary
(NAT-sharers collide; IP-rotators evade); see ADR 0001.
_Avoid_: user, sender, guest

**Member**:
An admin-issued account that sends pings without a Cooldown and without captcha.
Has a fixed display name. There is no public signup — accounts are handed out.
_Avoid_: wall user, account, user, friend

**Cooldown**:
The per-Visitor lockout window (30 min in prod, 20 s in dev) that begins when a
Ping is accepted. Blocks a second Ping from the same IP. Released if the Ping
ultimately fails to print, so a failure never locks a Visitor out. Members have
no Cooldown.
_Avoid_: rate limit, throttle, ban, timeout

**Budget**:
Ping's cached estimate of how much Printer API Quota remains, learned from the
`X-RateLimit-*` headers on every API response. Shared across all Visitors. When
exhausted, the Drain pauses until the reset time the headers reported.
_Avoid_: quota, rate limit, allowance

**Drain**:
The background loop that forwards pending pings to the Printer API, one at a time,
only while the Budget allows. Ping's sole throttling mechanism against the API.
_Avoid_: worker, flush, sender, pump

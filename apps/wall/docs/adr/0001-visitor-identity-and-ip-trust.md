# Visitor identity is the client IP, trusted from one proxy hop

A Visitor has no account, so the Cooldown can only be keyed on something
ambient: the client IP. We key on the full IPv4 address and on the **/64 prefix**
for IPv6 (a single v6 host otherwise gets a near-infinite supply of addresses for
free). The Wall reads that IP from a **single configured proxy header** (the
reverse proxy we deploy behind), and does **not** trust caller-supplied
`X-Forwarded-For` when reachable directly — otherwise any client could spoof the
header and reset its own Cooldown at will.

This is deliberately not airtight identity. CGNAT and carrier NAT mean some
unrelated Visitors share an IP and will block each other for the Cooldown window;
a determined abuser can still rotate IPs. The Cooldown's job is to stop casual
roll-spamming, not to be a real identity boundary — Members (admin-issued
accounts) are the escape hatch for people who legitimately need to send more than
one ping.

## Considered options

- **Blindly trust `X-Forwarded-For`** (the original implementation): convenient,
  but reduces the Cooldown to theater the moment the origin is directly reachable.
- **Per-full-IPv6-address**: lets any v6 user bypass the Cooldown by picking a new
  address from their /64, which every v6 allocation grants.
- **Cookie / localStorage token**: trivially cleared, so weaker than IP, and adds
  a consent surface for a throwaway wall. Rejected.

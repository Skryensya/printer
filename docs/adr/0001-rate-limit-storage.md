# Minute window in memory, day window in SQLite

The Quota has two windows with different persistence requirements. The Minute Window (sliding 60s) is tracked in a process-level Map: losing it on restart costs at most 60 seconds of under-counting, which is acceptable. The Day Window (fixed UTC day) is tracked in SQLite so daily caps survive restarts — otherwise a deliberate reboot would silently reset every caller's daily usage.

## Considered options

- Both in SQLite: adds a write per request to the hot path for the minute window, with no meaningful benefit since a 60s slip on restart is harmless.
- Both in memory: leaves daily caps unenforceable across restarts, a trivially exploitable loophole.

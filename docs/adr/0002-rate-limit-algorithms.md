# Sliding window for minutes, fixed window for days

The Minute Window uses a sliding algorithm (per-key list of request timestamps, evict anything older than 60s). This prevents burst abuse at window boundaries — with a fixed minute bucket a caller could fire their full quota at :58 and again at :01, doubling the burst rate. For a thermal printer that burst matters more than the complexity cost.

The Day Window uses a fixed UTC calendar day. The boundary-burst problem is less severe at day scale, and "your quota resets at midnight UTC" is something callers can reason about and communicate to their users.

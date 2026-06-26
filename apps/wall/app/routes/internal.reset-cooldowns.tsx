import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseStatus, setResponseHeader } from "@tanstack/react-start/server";

// Internal, secret-guarded endpoint that wipes every IP cooldown — the engine
// behind print-admin's "reset wall cooldowns" button. It lives as a route (not a
// bare server fn) so it has a stable URL the admin can call, and it runs inside
// the SSR bundle, so it mutates the *same* in-memory cooldown ledger the rate
// limiter reads (a separate process/module would see a stale copy).
//
// Auth is a shared secret in the X-Wall-Admin-Key header (set WALL_ADMIN_KEY on
// both this app and print-admin). Without it, or on mismatch, it 401s and clears
// nothing.
const resetCooldownsFn = createServerFn({ method: "GET" }).handler(async () => {
  const key      = process.env["WALL_ADMIN_KEY"] ?? "";
  const provided = getRequestHeader("x-wall-admin-key");
  if (!key || provided !== key) {
    setResponseStatus(401);
    return { ok: false as const, cleared: 0 };
  }
  const { clearAllCooldowns } = await import("~/server/store");
  const cleared = clearAllCooldowns();
  // Surface the count to the caller without parsing the HTML body.
  setResponseHeader("x-cooldowns-cleared", String(cleared));
  return { ok: true as const, cleared };
});

export const Route = createFileRoute("/internal/reset-cooldowns")({
  loader: () => resetCooldownsFn(),
  component: ResetResult,
});

function ResetResult() {
  const data = Route.useLoaderData();
  return (
    <pre style={{ fontFamily: "monospace", padding: 16 }}>
      {JSON.stringify(data)}
    </pre>
  );
}

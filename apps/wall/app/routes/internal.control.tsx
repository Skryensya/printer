import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestUrl, setResponseStatus, setResponseHeader } from "@tanstack/react-start/server";

// Internal, secret-guarded control panel endpoint — the engine behind
// print-admin's anti-abuse controls. Like /internal/reset-cooldowns it lives as
// a route (stable URL, runs inside the SSR bundle so it mutates the live state)
// and authenticates with the shared X-Wall-Admin-Key header.
//
// Actions (via ?action=): status (default), set-anon&value=block|allow,
// block-ip&ip=…, unblock-ip&ip=…. The resulting controls state is returned as a
// base64-JSON response header so the admin proxy reads it without parsing HTML.
const controlFn = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env["WALL_ADMIN_KEY"] ?? "";
  if (!key || getRequestHeader("x-wall-admin-key") !== key) {
    setResponseStatus(401);
    return { ok: false as const };
  }

  const raw = getRequestUrl();
  const url = typeof raw === "string" ? new URL(raw, "http://wall") : raw;
  const action = url.searchParams.get("action") ?? "status";
  const ip     = url.searchParams.get("ip") ?? "";
  const value  = url.searchParams.get("value");

  const store = await import("~/server/store");
  switch (action) {
    case "set-anon":   store.setAnonBlocked(value === "block"); break;
    case "block-ip":   store.blockIp(ip);   break;
    case "unblock-ip": store.unblockIp(ip); break;
    // "status" / unknown → just read
  }

  const controls = store.getControls();
  setResponseHeader("x-wall-control", Buffer.from(JSON.stringify(controls)).toString("base64"));
  return { ok: true as const, controls };
});

export const Route = createFileRoute("/internal/control")({
  loader: () => controlFn(),
  component: () => null,
});

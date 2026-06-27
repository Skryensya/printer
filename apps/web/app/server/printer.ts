// Server-side proxy to the printer API. The system keys (admin + service) live
// here as plain env vars (no VITE_ prefix), so they never reach the browser
// bundle. The client calls these server functions; only the web server holds
// the keys and talks to the printer API.
//
// Self-contained on purpose: useSession + the server functions live in this same
// module so TanStack Start's import-protection can extract them cleanly (the same
// reason session.ts keeps its session helper local).
import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

function apiBase(): string {
  // Defaults to prod; set PRINTER_API_URL=http://localhost:5801 in .env for local dev.
  return (process.env["PRINTER_API_URL"] ?? "https://printer-api.skryensya.dev").replace(/\/+$/, "");
}

async function isAuthed(): Promise<boolean> {
  const session = await useSession<{ authenticated: boolean }>({
    password: process.env["SESSION_SECRET"] ?? "printer-dev-secret-key-min-32-chars!!",
  });
  return session.data.authenticated === true;
}

export interface ProxyResult {
  ok:     boolean;
  status: number;
  // Raw response text (JSON), parsed by the caller. Kept as a string because
  // server-fn return values must be serializable.
  body:   string | null;
}

// Generic authenticated proxy. `admin` selects which system key to inject.
export const apiFn = createServerFn({ method: "POST" })
  .validator((d: { method: string; path: string; body?: unknown; admin?: boolean }) => d)
  .handler(async ({ data }): Promise<ProxyResult> => {
    if (!(await isAuthed())) return { ok: false, status: 401, body: JSON.stringify({ error: "Not authenticated" }) };

    const key = data.admin
      ? (process.env["ADMIN_API_KEY"]   ?? "")
      : (process.env["PRINTER_API_KEY"] ?? "");

    const res = await fetch(apiBase() + data.path, {
      method:  data.method,
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body:    data.body !== undefined ? JSON.stringify(data.body) : undefined,
    });

    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text || null };
  });

// Reset every IP cooldown on the wall (a testing aid). The wall owns this state
// in its own process, so we reach it over HTTP at WALL_INTERNAL_URL, authed with
// the shared WALL_ADMIN_KEY secret. Gated behind the admin session like the rest.
export const resetWallCooldownsFn = createServerFn({ method: "POST" })
  .handler(async (): Promise<{ ok: boolean; cleared: number | null; error?: string }> => {
    if (!(await isAuthed())) return { ok: false, cleared: null, error: "Not authenticated" };

    const base = process.env["WALL_INTERNAL_URL"] ?? "http://localhost:5803";
    const key  = process.env["WALL_ADMIN_KEY"] ?? "";
    if (!key) return { ok: false, cleared: null, error: "WALL_ADMIN_KEY not configured" };

    try {
      const res = await fetch(`${base}/internal/reset-cooldowns`, {
        headers: { "X-Wall-Admin-Key": key },
      });
      // The wall renders this as a document route, so its HTTP status is always
      // 200; success is signalled by the count header (set only on the authed
      // path). Its absence means the secret was rejected or misconfigured.
      const header = res.headers.get("x-cooldowns-cleared");
      if (header === null) return { ok: false, cleared: null, error: "Wall rejected the request — check WALL_ADMIN_KEY matches on both apps" };
      return { ok: true, cleared: Number(header) };
    } catch (e) {
      return { ok: false, cleared: null, error: e instanceof Error ? e.message : "Network error" };
    }
  });

// Anti-abuse controls on the wall (pause anon pings, block IPs). Same channel as
// resetWallCooldownsFn: reach the wall over HTTP, authed with WALL_ADMIN_KEY.
// The wall returns the full controls state as a base64-JSON response header.
export interface WallControls { anonBlocked: boolean; blockedIps: string[]; cooldownMs: number }

export const wallControlFn = createServerFn({ method: "POST" })
  .validator((d: { action?: string; ip?: string; value?: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; controls: WallControls | null; error?: string }> => {
    if (!(await isAuthed())) return { ok: false, controls: null, error: "Not authenticated" };

    const base = process.env["WALL_INTERNAL_URL"] ?? "http://localhost:5803";
    const key  = process.env["WALL_ADMIN_KEY"] ?? "";
    if (!key) return { ok: false, controls: null, error: "WALL_ADMIN_KEY not configured" };

    const qs = new URLSearchParams();
    if (data.action) qs.set("action", data.action);
    if (data.ip)     qs.set("ip", data.ip);
    if (data.value)  qs.set("value", data.value);

    try {
      const res = await fetch(`${base}/internal/control?${qs.toString()}`, {
        headers: { "X-Wall-Admin-Key": key },
      });
      // Like reset-cooldowns: the wall renders a document (status always 200),
      // so success is signalled by the state header. Its absence = rejected.
      const header = res.headers.get("x-wall-control");
      if (header === null) return { ok: false, controls: null, error: "Wall rejected the request — check WALL_ADMIN_KEY matches on both apps" };
      const controls = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as WallControls;
      return { ok: true, controls };
    } catch (e) {
      return { ok: false, controls: null, error: e instanceof Error ? e.message : "Network error" };
    }
  });

// Short-lived signed token for the watch WebSocket, so the admin key never
// travels to the browser. The printer API verifies the same HMAC.
export const watchTokenFn = createServerFn({ method: "GET" }).handler(async (): Promise<{ url: string | null }> => {
  if (!(await isAuthed())) return { url: null };
  const { createHmac } = await import("node:crypto");
  const secret = process.env["ADMIN_API_KEY"] ?? "";
  const exp    = Date.now() + 30_000; // 30s to open the socket
  const sig    = createHmac("sha256", secret).update(String(exp)).digest("hex");
  const ws     = apiBase().replace(/^http/, "ws");
  return { url: `${ws}/ws/watch?token=${exp}.${sig}` };
});

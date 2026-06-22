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
  return process.env["PRINTER_API_URL"] ?? "http://localhost:5801";
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

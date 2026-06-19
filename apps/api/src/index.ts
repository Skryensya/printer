import { healthHandler } from "./handlers/health";
import {
  printTextHandler, printTicketHandler, printQrHandler,
  printBarcodeHandler, printImageHandler, printBordersHandler, printTestHandler,
} from "./handlers/print";
import {
  listKeysHandler, createKeyHandler, revokeKeyHandler, deleteKeyHandler,
} from "./handlers/keys";
import {
  getJobHandler, listJobsHandler, retryJobHandler, cancelJobHandler,
} from "./handlers/jobs";
import { withServiceAuth, withAdminAuth } from "./middleware/auth";
import { withCors } from "./middleware/cors";
import { broadcastToWatchers, pushJobToAgent, startPingInterval, websocketHandlers, isAgentConnected } from "./websocket";
import { initQueue } from "./queue";
import { verifyApiKey, resetStuckJobs } from "./db";

// ─── Boot ─────────────────────────────────────────────────────────────────────

const stuck = resetStuckJobs();
if (stuck > 0) console.log(`  Reset ${stuck} stuck job(s) to pending`);

initQueue({ broadcast: broadcastToWatchers, pushToAgent: pushJobToAgent });
startPingInterval();

// ─── Router ──────────────────────────────────────────────────────────────────

async function router(req: Request): Promise<Response> {
  const url    = new URL(req.url);
  const path   = url.pathname;
  const method = req.method;

  // ── WebSocket upgrades ──────────────────────────────────────────────────────
  if (path === "/ws/agent" && req.headers.get("upgrade") === "websocket") {
    const raw = req.headers.get("X-API-Key") ?? url.searchParams.get("key") ?? "";
    const key = await verifyApiKey(raw);
    if (!key) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return server.upgrade(req, { data: { role: "agent" } })
      ? new Response()
      : new Response("WebSocket upgrade failed", { status: 500 });
  }

  if (path === "/ws/watch" && req.headers.get("upgrade") === "websocket") {
    const adminKey = process.env["ADMIN_API_KEY"] ?? "";
    const raw = req.headers.get("X-API-Key") ?? url.searchParams.get("key") ?? "";
    if (!adminKey || raw !== adminKey) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return server.upgrade(req, { data: { role: "watcher" } })
      ? new Response()
      : new Response("WebSocket upgrade failed", { status: 500 });
  }

  // ── Health (public) ─────────────────────────────────────────────────────────
  if (method === "GET" && path === "/health") {
    return withCors(healthHandler)(req);
  }

  // ── Agent status (public) ───────────────────────────────────────────────────
  if (method === "GET" && path === "/api/v1/agent") {
    return withCors(() => Response.json({ ok: true, connected: isAgentConnected() }))(req);
  }

  // ── Print endpoints (service auth) ─────────────────────────────────────────
  if (method === "POST") {
    const printRoutes: Record<string, typeof printTextHandler> = {
      "/api/v1/print/text":    printTextHandler,
      "/api/v1/print/ticket":  printTicketHandler,
      "/api/v1/print/qr":      printQrHandler,
      "/api/v1/print/barcode": printBarcodeHandler,
      "/api/v1/print/image":   printImageHandler,
      "/api/v1/print/borders": printBordersHandler,
      "/api/v1/print/test":    printTestHandler,
    };
    const handler = printRoutes[path];
    if (handler) return withCors(withServiceAuth(handler))(req);
  }

  // ── Jobs (service auth for GET single, admin for rest) ─────────────────────
  if (method === "GET" && path === "/api/v1/jobs") {
    return withCors(withAdminAuth(listJobsHandler))(req);
  }

  const jobActionMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)\/(retry|cancel)$/);
  if (jobActionMatch && method === "POST") {
    const id     = jobActionMatch[1]!;
    const action = jobActionMatch[2]!;
    const fn = action === "retry" ? retryJobHandler : cancelJobHandler;
    return withCors(withAdminAuth((req) => fn(req, id)))(req);
  }

  const jobMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)$/);
  if (jobMatch && method === "GET") {
    const id = jobMatch[1]!;
    return withCors(withServiceAuth((req) => getJobHandler(req, id)))(req);
  }

  // ── API key management (admin only) ─────────────────────────────────────────
  if (path === "/api/v1/keys") {
    if (method === "GET")  return withCors(withAdminAuth(listKeysHandler))(req);
    if (method === "POST") return withCors(withAdminAuth(createKeyHandler))(req);
  }

  const keyMatch = path.match(/^\/api\/v1\/keys\/([^/]+)$/);
  if (keyMatch) {
    const id = keyMatch[1]!;
    if (method === "DELETE") return withCors(withAdminAuth((req) => deleteKeyHandler(req, id)))(req);
  }

  const revokeMatch = path.match(/^\/api\/v1\/keys\/([^/]+)\/revoke$/);
  if (revokeMatch && method === "POST") {
    const id = revokeMatch[1]!;
    return withCors(withAdminAuth((req) => revokeKeyHandler(req, id)))(req);
  }

  return withCors(() => Response.json({ ok: false, error: "Not found" }, { status: 404 }))(req);
}

// ─── Server ──────────────────────────────────────────────────────────────────

const port = Number(process.env["PORT"] ?? 3001);

const server = Bun.serve({
  port,
  fetch: router,
  websocket: {
    ...websocketHandlers,
    idleTimeout: 120, // seconds — pings fire every 30s so this is never reached
  },
});

console.log(`  Printer API running on http://localhost:${port}`);
if (!process.env["ADMIN_API_KEY"]) {
  console.warn("  Warning: ADMIN_API_KEY is not set — admin routes are disabled");
}

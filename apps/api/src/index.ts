import { healthHandler } from "./handlers/health";
import {
  printTextHandler, printTicketHandler, printTodoHandler,
  printMessageHandler, printImageHandler, printBordersHandler, printTestHandler,
} from "./handlers/print";
import {
  listKeysHandler, createKeyHandler, updateKeyHandler, revokeKeyHandler, deleteKeyHandler, getKeyMeHandler, getKeyStatsHandler,
} from "./handlers/keys";
import {
  getJobHandler, listJobsHandler, retryJobHandler, cancelJobHandler, deleteJobHandler, reprintJobHandler,
} from "./handlers/jobs";
import {
  listWallUsersHandler, createWallUserHandler, deleteWallUserHandler, wallLoginHandler,
} from "./handlers/wall";
import { withServiceAuth, withAdminAuth, withMessageAuth, withJobAuth, authenticateKey, extractRaw } from "./middleware/auth";
import { withCors } from "./middleware/cors";
import { broadcastToWatchers, pushJobToAgent, startPingInterval, websocketHandlers, getAgentStatus } from "./websocket";
import { initQueue } from "./queue";
import { verifyApiKey, resetStuckJobs, migrate } from "./db";
import { verifyWatchToken } from "./watch-token";

// ─── Boot ─────────────────────────────────────────────────────────────────────

await migrate();

const stuck = await resetStuckJobs();
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
    // Agents may present the key via header or (browserless clients) a query param.
    const raw = extractRaw(req) ?? url.searchParams.get("key") ?? "";
    const key = await verifyApiKey(raw);
    if (!key) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return server.upgrade(req, { data: { role: "agent" } })
      ? new Response()
      : new Response("WebSocket upgrade failed", { status: 500 });
  }

  if (path === "/ws/watch" && req.headers.get("upgrade") === "websocket") {
    const adminKey  = process.env["ADMIN_API_KEY"] ?? "";
    const headerKey = req.headers.get("X-API-Key") ?? "";
    const token     = url.searchParams.get("token") ?? "";
    // Browser watchers present a short-lived signed token (no admin key in the
    // URL); server-side tools may still use the admin key via header.
    const authorized =
      !!adminKey &&
      ((headerKey !== "" && headerKey === adminKey) || verifyWatchToken(token, adminKey));
    if (!authorized) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return server.upgrade(req, { data: { role: "watcher" } })
      ? new Response()
      : new Response("WebSocket upgrade failed", { status: 500 });
  }

  // ── Health (admin) ──────────────────────────────────────────────────────────
  if (method === "GET" && path === "/health") {
    return withCors(healthHandler)(req);
  }

  // ── Agent status (admin) ────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/v1/agent") {
    return withCors(withAdminAuth(() => Response.json({ status: getAgentStatus() })))(req);
  }

  // ── Print endpoints (service auth + per-key type allowlist) ───────────────
  if (method === "POST") {
    // Message uses its own auth wrapper (checks "message" OR "message_custom")
    if (path === "/api/v1/print/message") {
      return withCors(withMessageAuth(printMessageHandler))(req);
    }

    const printRoutes: Record<string, { type: string; fn: typeof printTextHandler }> = {
      "/api/v1/print/text":    { type: "text",    fn: printTextHandler    },
      "/api/v1/print/ticket":  { type: "ticket",  fn: printTicketHandler  },
      "/api/v1/print/todo":    { type: "todo",    fn: printTodoHandler    },
      "/api/v1/print/image":   { type: "image",   fn: printImageHandler   },
      "/api/v1/print/borders": { type: "borders", fn: printBordersHandler },
      "/api/v1/print/test":    { type: "test",    fn: printTestHandler    },
    };
    const route = printRoutes[path];
    if (route) return withCors(withServiceAuth(route.type, route.fn))(req);
  }

  // ── Jobs (service auth for GET single, admin for rest) ─────────────────────
  if (method === "GET" && path === "/api/v1/jobs") {
    return withCors(withAdminAuth(listJobsHandler))(req);
  }

  const jobActionMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)\/(retry|cancel|reprint)$/);
  if (jobActionMatch && method === "POST") {
    const id     = jobActionMatch[1]!;
    const action = jobActionMatch[2]!;
    const fn = action === "retry" ? retryJobHandler : action === "reprint" ? reprintJobHandler : cancelJobHandler;
    return withCors(withAdminAuth((req) => fn(req, id)))(req);
  }

  const jobMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)$/);
  if (jobMatch && method === "DELETE") {
    const id = jobMatch[1]!;
    return withCors(withAdminAuth((req) => deleteJobHandler(req, id)))(req);
  }
  if (jobMatch && method === "GET") {
    const id = jobMatch[1]!;
    return withCors(withJobAuth((req, source) => getJobHandler(req, id, source)))(req);
  }

  // ── API key management (admin only) ─────────────────────────────────────────
  if (path === "/api/v1/keys") {
    if (method === "GET")  return withCors(withAdminAuth(listKeysHandler))(req);
    if (method === "POST") return withCors(withAdminAuth(createKeyHandler))(req);
  }

  // /keys/me and /keys/stats must be registered before /keys/:id so they don't match as an id
  if (method === "GET" && path === "/api/v1/keys/me") {
    return withCors(getKeyMeHandler)(req);
  }
  if (method === "GET" && path === "/api/v1/keys/stats") {
    return withCors(withAdminAuth(getKeyStatsHandler))(req);
  }

  const keyMatch = path.match(/^\/api\/v1\/keys\/([^/]+)$/);
  if (keyMatch) {
    const id = keyMatch[1]!;
    if (method === "PATCH")  return withCors(withAdminAuth((req) => updateKeyHandler(req, id)))(req);
    if (method === "DELETE") return withCors(withAdminAuth((req) => deleteKeyHandler(req, id)))(req);
  }

  const revokeMatch = path.match(/^\/api\/v1\/keys\/([^/]+)\/revoke$/);
  if (revokeMatch && method === "POST") {
    const id = revokeMatch[1]!;
    return withCors(withAdminAuth((req) => revokeKeyHandler(req, id)))(req);
  }

  // ── Wall accounts ────────────────────────────────────────────────────────────
  // Login verification: called server-side by the wall with any valid API key.
  // Auth'd (so it can't be brute-forced via the public API) but not quota-counted.
  if (path === "/api/v1/wall/login" && method === "POST") {
    return withCors(async (req) => {
      if (!(await authenticateKey(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return wallLoginHandler(req);
    })(req);
  }
  // Admin management (the print-admin backoffice)
  if (path === "/api/v1/wall/users") {
    if (method === "GET")  return withCors(withAdminAuth(listWallUsersHandler))(req);
    if (method === "POST") return withCors(withAdminAuth(createWallUserHandler))(req);
  }
  const wallUserMatch = path.match(/^\/api\/v1\/wall\/users\/([^/]+)$/);
  if (wallUserMatch && method === "DELETE") {
    const username = decodeURIComponent(wallUserMatch[1]!);
    return withCors(withAdminAuth((req) => deleteWallUserHandler(req, username)))(req);
  }

  return withCors(() => Response.json({ error: "Not found" }, { status: 404 }))(req);
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

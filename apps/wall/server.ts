// Production server for the built wall app.
// `bun run build` emits a fetch handler at dist/server/server.js (it does NOT
// listen or serve static assets). This wraps it with Bun.serve: static files
// from dist/client first, everything else to the SSR handler.
import { join } from "node:path";
import handler from "./dist/server/server.js";

const PORT       = Number(process.env["PORT"] ?? 3000);
const CLIENT_DIR = join(import.meta.dir, "dist", "client");

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/") {
      const file = Bun.file(join(CLIENT_DIR, url.pathname));
      if (await file.exists()) return new Response(file);
    }
    return (handler as { fetch: (r: Request) => Promise<Response> }).fetch(req);
  },
});

console.log(`  Wall running on http://localhost:${PORT}`);

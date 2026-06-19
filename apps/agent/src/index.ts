import { Printer, executeJob, parseServerEvent, type JobType } from "@printer/core";

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVER_URL   = process.env["SERVER_URL"] ?? "http://localhost:3001";
const API_KEY      = process.env["API_KEY"] ?? "";
const DRY_RUN      = process.env["DRY_RUN"] === "true";
const RECONNECT_MS = 3_000;

if (!API_KEY) {
  console.error("API_KEY env var is required");
  process.exit(1);
}

const WS_URL = SERVER_URL.replace(/^http/, "ws") + `/ws/agent?key=${encodeURIComponent(API_KEY)}`;

// ─── Job execution ────────────────────────────────────────────────────────────

async function runJob(type: JobType, payload: unknown): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [dry-run] ${type}`, JSON.stringify(payload).slice(0, 80));
    await Bun.sleep(200);
    return;
  }
  const printer = new Printer();
  await printer.job(async (p) => executeJob(type, payload, p));
}

// ─── WebSocket agent ──────────────────────────────────────────────────────────

function connect() {
  console.log(`  Connecting to ${SERVER_URL} …`);

  const ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    console.log("  Agent connected");
  });

  ws.addEventListener("message", async (event) => {
    const msg = parseServerEvent(String(event.data));
    if (!msg || msg.event !== "job:print") return;

    const { id, type, payload } = msg.job;
    console.log(`  Printing job ${id} [${type}]`);

    ws.send(JSON.stringify({ event: "job:started", jobId: id }));

    try {
      await runJob(type, payload);
      ws.send(JSON.stringify({ event: "job:done", jobId: id }));
      console.log(`  Job ${id} done`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isPrinterMissing = message.toLowerCase().includes("not found") ||
                               message.toLowerCase().includes("not connected");

      if (isPrinterMissing) {
        console.warn(`  Printer unavailable: ${message}`);
        ws.send(JSON.stringify({ event: "job:failed", jobId: id, error: "printer_unavailable:" + message }));
      } else {
        console.error(`  Job ${id} failed: ${message}`);
        ws.send(JSON.stringify({ event: "job:failed", jobId: id, error: message }));
      }
    }
  });

  ws.addEventListener("close", (event) => {
    const reason = event.reason ? ` — ${event.reason}` : "";
    const meaning: Record<number, string> = {
      1000: "normal close",
      1001: "server going away",
      1006: "connection dropped",
      1008: "replaced by new agent",
      1011: "server error",
    };
    const label = meaning[event.code] ?? `code ${event.code}`;
    console.log(`  Disconnected (${label}${reason}). Reconnecting in ${RECONNECT_MS / 1000}s…`);
    setTimeout(connect, RECONNECT_MS);
  });

  ws.addEventListener("error", (event) => {
    console.error("  WebSocket error:", (event as ErrorEvent).message ?? event);
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (DRY_RUN) console.log("  DRY_RUN mode — jobs will be simulated, not printed");
connect();

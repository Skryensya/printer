import { Printer, buildJobCommands, parseServerEvent, type JobType } from "@printer/core";
import { withPrinterLock } from "./printer-lock";

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVER_URL      = process.env["SERVER_URL"] ?? "http://localhost:3001";
const API_KEY         = process.env["API_KEY"] ?? "";
const DRY_RUN         = process.env["DRY_RUN"] === "true";
const RECONNECT_MS    = 3_000;
const PRINTER_POLL_MS = 4_000;

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
  const cmds = await buildJobCommands(type, payload);
  // Serialize across agent processes — another agent may share this printer.
  await withPrinterLock(() => printer.job(async (p) => p.send(...cmds)));
}

// ─── Printer monitor ──────────────────────────────────────────────────────────

let printerReady   = false;
let monitorRunning = false;

async function checkPrinter(ws: WebSocket): Promise<void> {
  if (DRY_RUN) {
    if (!printerReady) {
      printerReady = true;
      ws.send(JSON.stringify({ event: "printer:ready" }));
    }
    return;
  }
  let present = false;
  try {
    present = await Printer.isPresent();
  } catch {
    present = false;
  }
  if (present === printerReady) return;   // no change — nothing to report
  printerReady = present;
  if (present) {
    console.log("  Printer connected");
    ws.send(JSON.stringify({ event: "printer:ready" }));
  } else {
    console.log("  Printer disconnected");
    ws.send(JSON.stringify({ event: "printer:disconnected" }));
  }
}

// Runs for the lifetime of the WebSocket connection, polling every PRINTER_POLL_MS.
async function monitorPrinter(ws: WebSocket): Promise<void> {
  if (monitorRunning) return;
  monitorRunning = true;
  printerReady   = false;

  await checkPrinter(ws);   // immediate check on connect

  while (ws.readyState === WebSocket.OPEN) {
    await Bun.sleep(PRINTER_POLL_MS);
    if (ws.readyState !== WebSocket.OPEN) break;
    await checkPrinter(ws);
  }

  monitorRunning = false;
}

// ─── WebSocket agent ──────────────────────────────────────────────────────────

function connect() {
  console.log(`  Connecting to ${SERVER_URL} …`);

  const ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    console.log("  Agent connected");
    monitorPrinter(ws);
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
      const lc = message.toLowerCase();
      const isPrinterBusy = lc.includes("printer_busy");
      const isPrinterMissing =
        lc.includes("not found") || lc.includes("not connected") || lc.includes("usb");

      if (isPrinterBusy) {
        // Couldn't get the shared printer lock in time — another agent is busy.
        // Requeue without consuming a retry; don't touch printer:ready state.
        console.warn(`  Printer busy, requeuing job ${id}`);
        ws.send(JSON.stringify({ event: "job:failed", jobId: id, reason: "printer_unavailable", error: message }));
      } else if (isPrinterMissing) {
        console.warn(`  Printer unavailable: ${message}`);
        ws.send(JSON.stringify({ event: "job:failed", jobId: id, reason: "printer_unavailable", error: message }));
        // Immediately report disconnection — don't wait for next poll cycle
        if (printerReady) {
          printerReady = false;
          ws.send(JSON.stringify({ event: "printer:disconnected" }));
        }
      } else {
        console.error(`  Job ${id} failed: ${message}`);
        ws.send(JSON.stringify({ event: "job:failed", jobId: id, reason: "job_error", error: message }));
      }
    }
  });

  ws.addEventListener("close", (event) => {
    monitorRunning = false;
    printerReady   = false;
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

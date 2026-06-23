import type { ServerWebSocket } from "bun";
import {
  onAgentConnected, onAgentDisconnected,
  onJobStarted, onJobDone, onJobFailed, jobPayload,
} from "./queue";
import { parseAgentEvent } from "@printer/core";
import type { Job } from "./db";

type WsData = { role: "agent" | "watcher" };

// ─── AgentConnection ──────────────────────────────────────────────────────────
// Encapsulates the three pieces of agent state (socket, printer-readiness,
// watcher set) behind a clean interface whose invariants are enforced by the
// class rather than by conventions scattered across three mutation sites.
//
// Invariant: ready() === true → ws is non-null and connected.

class AgentConnection {
  private ws:    ServerWebSocket<WsData> | null = null;
  private rdyFlag = false;

  isReady(): boolean { return this.ws !== null && this.rdyFlag; }

  status(): AgentStatus {
    if (!this.ws)      return "offline";
    if (!this.rdyFlag) return "printer_offline";
    return "ready";
  }

  /** Called when the Agent WebSocket opens. Closes any prior session. */
  accept(ws: ServerWebSocket<WsData>): void {
    if (this.ws) this.ws.close(1008, "replaced by new agent");
    this.ws      = ws;
    this.rdyFlag = false; // unknown until agent sends printer:ready
  }

  /** Printer confirmed ready — start dispatching jobs. */
  markReady(): void { this.rdyFlag = true; }

  /** Printer went offline mid-session — stop dispatching, keep socket alive. */
  markPrinterOffline(): void { this.rdyFlag = false; }

  /**
   * Try to push a job to the agent.
   * Returns true if sent, false if no agent / not ready / socket dead.
   * On a dead socket, cleans up state and triggers agent-disconnected handling.
   */
  push(job: Job): boolean {
    if (!this.ws || !this.rdyFlag) return false;
    try {
      this.ws.send(JSON.stringify({
        event: "job:print",
        job:   { id: job.id, type: job.type, payload: jobPayload(job) },
      }));
      return true;
    } catch {
      // Socket closed but the close event hasn't fired yet — clean up now
      this.ws      = null;
      this.rdyFlag = false;
      void onAgentDisconnected();
      return false;
    }
  }

  /**
   * Called when the WebSocket close event fires.
   * Returns true if this was the active agent (so callers can trigger cleanup).
   */
  disconnect(ws: ServerWebSocket<WsData>): boolean {
    if (this.ws !== ws) return false;
    this.ws      = null;
    this.rdyFlag = false;
    return true;
  }

  ping(): void { this.ws?.ping(); }
}

const agent = new AgentConnection();

// ─── Watcher set ─────────────────────────────────────────────────────────────

const watchers = new Set<ServerWebSocket<WsData>>();

export function broadcastToWatchers(msg: object): void {
  const text = JSON.stringify(msg);
  for (const ws of watchers) ws.send(text);
}

// ─── Public push — called by the Queue pump ──────────────────────────────────

export function pushJobToAgent(job: Job): boolean {
  return agent.push(job);
}

// ─── Ping interval ────────────────────────────────────────────────────────────

export function startPingInterval(): void {
  setInterval(() => {
    agent.ping();
    for (const ws of watchers) ws.ping();
  }, 30_000);
}

// ─── WebSocket handlers ───────────────────────────────────────────────────────

export const websocketHandlers = {
  open(ws: ServerWebSocket<WsData>) {
    if (ws.data.role === "agent") {
      agent.accept(ws);
      ws.send(JSON.stringify({ event: "connected" }));
      // Don't call onAgentConnected() yet — wait for printer:ready
    } else {
      watchers.add(ws);
      ws.send(JSON.stringify({ event: "connected" }));
    }
  },

  async message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    if (ws.data.role !== "agent") return;
    const msg = parseAgentEvent(String(raw));
    if (!msg) return;

    if (msg.event === "printer:ready") {
      agent.markReady();
      await onAgentConnected();     // dispatch all pending jobs
    } else if (msg.event === "printer:disconnected") {
      agent.markPrinterOffline();
      // Agent is still alive — push now returns false, so pump stalls naturally.
      // Jobs in "printing" will arrive as job:failed with reason printer_unavailable.
    } else if (msg.event === "job:started") {
      await onJobStarted(msg.jobId);
    } else if (msg.event === "job:done") {
      await onJobDone(msg.jobId);
    } else if (msg.event === "job:failed") {
      await onJobFailed(msg.jobId, msg.error, msg.reason);
    }
  },

  close(ws: ServerWebSocket<WsData>) {
    if (ws.data.role === "agent") {
      if (agent.disconnect(ws)) void onAgentDisconnected();
    } else {
      watchers.delete(ws);
    }
  },
};

// ─── Status query ─────────────────────────────────────────────────────────────

export type AgentStatus = "offline" | "printer_offline" | "ready";

export function getAgentStatus(): AgentStatus {
  return agent.status();
}

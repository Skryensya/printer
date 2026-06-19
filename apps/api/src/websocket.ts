import type { ServerWebSocket } from "bun";
import {
  onAgentConnected, onAgentDisconnected,
  onJobStarted, onJobDone, onJobFailed,
} from "./queue";
import { parseAgentEvent } from "@printer/core";
import type { Job } from "./db";

type WsData = { role: "agent" | "watcher" };

let agentWs: ServerWebSocket<WsData> | null = null;
const watchers = new Set<ServerWebSocket<WsData>>();

export function broadcastToWatchers(msg: object): void {
  const text = JSON.stringify(msg);
  for (const ws of watchers) ws.send(text);
}

export function pushJobToAgent(job: Job): void {
  if (!agentWs) return;
  agentWs.send(JSON.stringify({ event: "job:print", job: {
    id:      job.id,
    type:    job.type,
    payload: JSON.parse(job.payload),
  }}));
}

export function startPingInterval(): void {
  setInterval(() => {
    agentWs?.ping();
    for (const ws of watchers) ws.ping();
  }, 30_000);
}

export const websocketHandlers = {
  open(ws: ServerWebSocket<WsData>) {
    if (ws.data.role === "agent") {
      if (agentWs) agentWs.close(1008, "replaced by new agent");
      agentWs = ws;
      ws.send(JSON.stringify({ event: "connected" }));
      onAgentConnected();
    } else {
      watchers.add(ws);
      ws.send(JSON.stringify({ event: "connected" }));
    }
  },

  message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    if (ws.data.role !== "agent") return;
    const msg = parseAgentEvent(String(raw));
    if (!msg) return;
    if (msg.event === "job:started")     onJobStarted(msg.jobId);
    else if (msg.event === "job:done")   onJobDone(msg.jobId);
    else if (msg.event === "job:failed") onJobFailed(msg.jobId, msg.error);
  },

  close(ws: ServerWebSocket<WsData>) {
    if (ws.data.role === "agent" && agentWs === ws) {
      agentWs = null;
      onAgentDisconnected();
    } else {
      watchers.delete(ws);
    }
  },
};

export function isAgentConnected(): boolean {
  return agentWs !== null;
}

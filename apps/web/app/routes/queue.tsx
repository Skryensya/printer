import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  listJobs, retryJob, cancelJob, watchWsUrl,
  type PrintJob, type JobStatus,
} from "~/api";
import { renderTicket, renderBorders } from "@printer/core/render";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  PrinterBuffer, type PrintEntry, type PrintEntryInput, newId,
} from "~/components/printer-buffer";

export const Route = createFileRoute("/queue")({
  component: QueuePage,
});

// ─── Job preview ──────────────────────────────────────────────────────────────

function jobToEntries(job: PrintJob): PrintEntryInput[] {
  const p = job.payload as Record<string, unknown>;
  switch (job.type) {
    case "text":
      return [{ type: "text", text: String(p["text"] ?? ""), align: (p["align"] as "left"|"center"|"right") ?? "left", bold: Boolean(p["bold"]), size: Number(p["size"] ?? 1), invert: Boolean(p["invert"]) }];
    case "ticket":
      return [{ type: "text", text: renderTicket({
        id:       String(p["id"] ?? ""),
        title:    String(p["title"] ?? ""),
        priority: (p["priority"] as "LOW"|"MEDIUM"|"HIGH"|"CRITICAL") ?? "LOW",
        status:   (p["status"] as "TODO"|"IN PROGRESS"|"DONE"|"BLOCKED") ?? "TODO",
        assignee: p["assignee"] ? String(p["assignee"]) : undefined,
        due:      p["due"] ? String(p["due"]) : undefined,
        tags:     Array.isArray(p["tags"]) ? (p["tags"] as string[]) : undefined,
      }, (p["style"] as "thin"|"ascii"|"double"|"block"|"shade"|"stars") ?? "thin"),
      align: "left", bold: false, size: 1, invert: false }];
    case "qr":
      return [{ type: "qr", text: String(p["text"] ?? "") }];
    case "barcode":
      return [{ type: "barcode", data: String(p["data"] ?? ""), height: Number(p["height"] ?? 80) }];
    case "borders":
      return [{ type: "text", text: renderBorders(), align: "left", bold: false, size: 1, invert: false }];
    default:
      return [{ type: "text", text: `[${job.type}]`, align: "center", bold: false, size: 1, invert: false }];
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<JobStatus, "default"|"secondary"|"destructive"|"outline"> = {
  pending:   "secondary",
  printing:  "outline",
  done:      "default",
  failed:    "destructive",
  cancelled: "secondary",
};

function StatusBadge({ status }: { status: JobStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}

// ─── Job row ──────────────────────────────────────────────────────────────────

function JobRow({
  job, selected, onSelect, onRetry, onCancel,
}: {
  job: PrintJob;
  selected: boolean;
  onSelect: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const date = new Date(job.created_at * 1000).toLocaleTimeString();
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:bg-accent ${selected ? "bg-accent" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground truncate">{job.id.slice(0, 8)}</span>
        <StatusBadge status={job.status} />
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="truncate">{job.type} · {job.source}</span>
        <span className="text-xs text-muted-foreground flex-shrink-0">{date}</span>
      </div>
      {job.error && <p className="text-xs text-destructive mt-0.5 truncate">{job.error}</p>}
      {selected && (job.status === "failed" || job.status === "pending") && (
        <div className="flex gap-1 mt-1.5" onClick={e => e.stopPropagation()}>
          {job.status === "failed" && (
            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={onRetry}>Retry</Button>
          )}
          {(job.status === "pending") && (
            <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-destructive" onClick={onCancel}>Cancel</Button>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function QueuePage() {
  const [jobs, setJobs]         = useState<PrintJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const selected = jobs.find(j => j.id === selectedId) ?? null;

  // Initial load
  useEffect(() => {
    listJobs().then(setJobs).catch(console.error);
  }, []);

  // WebSocket live updates
  useEffect(() => {
    const url = watchWsUrl();
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { event: string; job?: PrintJob; jobs?: PrintJob[] };
      if (msg.event === "job:queued" || msg.event === "job:printing" ||
          msg.event === "job:done"   || msg.event === "job:failed"   ||
          msg.event === "job:cancelled") {
        if (msg.job) {
          setJobs(prev => {
            const idx = prev.findIndex(j => j.id === msg.job!.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg.job!;
              return next;
            }
            return [msg.job!, ...prev];
          });
        }
      } else if (msg.event === "jobs:reset" && msg.jobs) {
        setJobs(prev => {
          const map = new Map(prev.map(j => [j.id, j]));
          for (const j of msg.jobs!) map.set(j.id, j);
          return [...map.values()].sort((a, b) => b.created_at - a.created_at);
        });
      }
    };

    ws.onerror = () => {};

    return () => ws.close();
  }, []);

  async function handleRetry(id: string) {
    await retryJob(id).catch(console.error);
  }

  async function handleCancel(id: string) {
    await cancelJob(id).catch(console.error);
  }

  const queueJobs = jobs.filter(j => j.status === "pending" || j.status === "printing");
  const logJobs   = jobs.filter(j => j.status === "done" || j.status === "failed" || j.status === "cancelled");

  const previewEntries: PrintEntry[] = selected
    ? jobToEntries(selected).map(e => ({ ...e, id: newId() } as PrintEntry))
    : [];

  return (
    <div className="h-full flex overflow-hidden">
      {/* Job list */}
      <div className="w-96 flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
        <Tabs defaultValue="queue" className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-shrink-0 px-3 pt-3">
            <TabsList className="w-full">
              <TabsTrigger value="queue" className="flex-1">
                Queue {queueJobs.length > 0 && <span className="ml-1 text-xs">({queueJobs.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="log" className="flex-1">Log</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="queue" className="flex-1 overflow-y-auto px-2 py-1 mt-0 space-y-0.5">
            {queueJobs.length === 0
              ? <p className="text-xs text-muted-foreground text-center py-8">Queue is empty</p>
              : queueJobs.map(job => (
                <JobRow
                  key={job.id}
                  job={job}
                  selected={selectedId === job.id}
                  onSelect={() => setSelectedId(job.id)}
                  onRetry={() => handleRetry(job.id)}
                  onCancel={() => handleCancel(job.id)}
                />
              ))
            }
          </TabsContent>

          <TabsContent value="log" className="flex-1 overflow-y-auto px-2 py-1 mt-0 space-y-0.5">
            {logJobs.length === 0
              ? <p className="text-xs text-muted-foreground text-center py-8">No log entries</p>
              : logJobs.map(job => (
                <JobRow
                  key={job.id}
                  job={job}
                  selected={selectedId === job.id}
                  onSelect={() => setSelectedId(job.id)}
                  onRetry={() => handleRetry(job.id)}
                  onCancel={() => handleCancel(job.id)}
                />
              ))
            }
          </TabsContent>
        </Tabs>
      </div>

      {/* Preview panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-4 py-3 border-b border-border">
          <p className="text-sm font-medium">Preview</p>
          {selected && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {selected.type} · {selected.source} · {new Date(selected.created_at * 1000).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex justify-center">
          {selected
            ? <PrinterBuffer entries={previewEntries} />
            : <p className="text-sm text-muted-foreground mt-8">Select a job to preview</p>
          }
        </div>
      </div>
    </div>
  );
}

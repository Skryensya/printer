import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Ban, RefreshCw, Trash2, Printer as PrinterIcon,
  Type, QrCode, Barcode, ImageIcon, Ticket, LayoutGrid,
  X, CheckSquare, ChevronDown, ChevronsDownUp, ChevronsUpDown, Copy, Check, ListTodo,
} from "lucide-react";
import {
  listJobs, getJob, retryJob, reprintJob, cancelJob, deleteJob, watchWsUrl,
  type PrintJob, type JobStatus,
} from "~/api";
import { renderTicket, renderBorders, renderCardSVG, buildTodoCard } from "@printer/core/render";
import type { JobPayloadMap, WatcherEvent } from "@printer/core";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  PrintPreview, type PrintEntry, type PrintEntryInput, newId,
} from "~/components/printer-buffer";

export const Route = createFileRoute("/queue")({
  loader: () => listJobs().catch(() => [] as PrintJob[]),
  component: QueuePage,
});

// Public API URL — for the replicable curl shown per job. Not a secret.
const API_BASE = import.meta.env["VITE_API_URL"] ?? "http://localhost:5801";

// Build a curl that re-creates this job as-is. The stored `v` (payload version)
// is dropped since it's set server-side. Image jobs are excluded (binary body).
function jobCurl(job: PrintJob): string {
  const { v: _v, ...body } = (job.payload ?? {}) as Record<string, unknown>;
  const hasBody = Object.keys(body).length > 0;
  const lines = [
    `curl -X POST ${API_BASE}/api/v1/print/${job.type}`,
    `-H "X-API-Key: YOUR_KEY"`,
  ];
  if (hasBody) {
    lines.push(`-H "Content-Type: application/json"`);
    lines.push(`-d '${JSON.stringify(body)}'`);
  }
  return lines.map((l, i) => (i === 0 ? l : `  ${l}`)).join(" \\\n");
}

// ─── Job → preview entries ────────────────────────────────────────────────────

function jobToEntries(job: PrintJob): PrintEntryInput[] {
  switch (job.type) {
    case "text": {
      const p = job.payload as JobPayloadMap["text"];
      return [{ type: "text", text: p.text, align: (p.align as "left"|"center"|"right") ?? "left", bold: p.bold ?? false, size: p.size ?? 1, invert: p.invert ?? false }];
    }
    case "ticket": {
      const p = job.payload as JobPayloadMap["ticket"];
      const svg = renderCardSVG(p);
      const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      return [{ type: "image", src, effect: "photo" as const }];
    }
    case "todo": {
      const p = job.payload as JobPayloadMap["todo"];
      const svg = renderCardSVG(buildTodoCard(p));
      const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      return [{ type: "image", src, effect: "photo" as const }];
    }
    case "qr": {
      const p = job.payload as JobPayloadMap["qr"];
      return [{ type: "qr", text: p.text }];
    }
    case "barcode": {
      const p = job.payload as JobPayloadMap["barcode"];
      return [{ type: "barcode", data: p.data, height: p.height ?? 80 }];
    }
    case "image": {
      const p = job.payload as JobPayloadMap["image"];
      // The list API strips image data to keep responses small; full data comes from getJob()
      if (typeof p.image !== "string" || p.image.startsWith("[base64")) return [];
      return [{ type: "image", src: `data:${p.mediaType ?? "image/png"};base64,${p.image}`, effect: (p.effect ?? "photo") as "photo" | "invert" }];
    }
    case "borders":
      return [{ type: "text", text: renderBorders(), align: "left", bold: false, size: 1, invert: false }];
    default:
      return [{ type: "text", text: `[${job.type}]`, align: "center", bold: false, size: 1, invert: false }];
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<JobStatus, { label: string; className: string }> = {
  pending:   { label: "Pending",   className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  printing:  { label: "Printing",  className: "bg-primary/10 text-primary border-primary/20" },
  done:      { label: "Done",      className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  failed:    { label: "Failed",    className: "bg-destructive/10 text-destructive border-destructive/20" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border-border" },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const { label, className } = STATUS_BADGE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}>
      {status === "printing" && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {label}
    </span>
  );
}

// ─── Type icon ────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.ElementType> = {
  text:    Type,
  ticket:  Ticket,
  todo:    ListTodo,
  qr:      QrCode,
  barcode: Barcode,
  image:   ImageIcon,
  borders: LayoutGrid,
};

function JobTypeIcon({ type }: { type: string }) {
  const Icon = TYPE_ICON[type] ?? Type;
  return <Icon size={12} className="text-muted-foreground/70 flex-shrink-0" />;
}

// ─── Job accordion row ────────────────────────────────────────────────────────

function JobRow({
  job, checked, expanded, selectionMode, onCheck, onToggle, onRetry, onReprint, onCancel, onDelete,
}: {
  job: PrintJob;
  checked: boolean;
  expanded: boolean;
  selectionMode: boolean;
  onCheck: () => void;
  onToggle: () => void;
  onRetry: () => void;
  onReprint: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fullJob, setFullJob] = useState<PrintJob | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyCurl() {
    try { await navigator.clipboard.writeText(jobCurl(job)); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable */ }
  }
  const time = new Date(job.created_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = new Date(job.created_at * 1000).toLocaleDateString([], { month: "short", day: "numeric" });

  useEffect(() => {
    if (!expanded || job.type !== "image" || fullJob !== null || loadingImage) return;
    setLoadingImage(true);
    getJob(job.id)
      .then(j => { setFullJob(j); setLoadingImage(false); })
      .catch(() => setLoadingImage(false));
  }, [expanded]);

  const jobForPreview = (job.type === "image" && fullJob) ? fullJob : job;
  const previewEntries: PrintEntry[] = jobToEntries(jobForPreview).map(e => ({ ...e, id: newId() } as PrintEntry));

  return (
    <div className={[
      "rounded-lg border transition-colors overflow-hidden",
      expanded
        ? "border-border bg-card shadow-sm"
        : checked
        ? "border-border/50 bg-accent/40"
        : "border-transparent hover:border-border/40 hover:bg-accent/30",
    ].join(" ")}>

      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none"
        onClick={() => selectionMode ? onCheck() : onToggle()}
      >
        {selectionMode && (
          <div onClick={e => { e.stopPropagation(); onCheck(); }} className="flex-shrink-0">
            <Checkbox checked={checked} />
          </div>
        )}

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <JobTypeIcon type={job.type} />
          <span className="text-sm font-medium">{job.type}</span>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <span className="text-xs text-muted-foreground truncate">{job.source}</span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/50 font-mono hidden sm:block [font-variant-numeric:tabular-nums]">
            {date} {time}
          </span>
          <StatusBadge status={job.status} />
          {!selectionMode && (
            <ChevronDown
              size={14}
              className={`text-muted-foreground/50 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            />
          )}
        </div>
      </div>

      {/* Accordion body */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/50 pt-3 space-y-3">
          {/* Error — full text */}
          {job.error && (
            <div className="rounded-md bg-destructive/8 border border-destructive/20 px-3 py-2">
              <p className="text-[11px] text-destructive font-mono leading-relaxed whitespace-pre-wrap break-all">
                {job.error}
              </p>
            </div>
          )}

          {/* Archived original (R2) */}
          {job.image_url && (
            <a href={job.image_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
              <ImageIcon size={12} /> Ver original
            </a>
          )}

          {/* Job ID + retry count */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/40 font-mono">{job.id}</span>
            {job.retry_count > 0 && (
              <span className="text-[10px] text-amber-600/70 [font-variant-numeric:tabular-nums]">
                {job.retry_count} retr{job.retry_count === 1 ? "y" : "ies"}
              </span>
            )}
          </div>

          {/* Print preview */}
          <div className="flex justify-start">
            <div className="shadow-md">
              {loadingImage ? (
                <div className="font-mono text-[11px] text-muted-foreground px-4 py-3"
                  style={{ width: "32ch" }}>
                  Loading image…
                </div>
              ) : (
                <PrintPreview entries={previewEntries} />
              )}
            </div>
          </div>

          {/* Parameters */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Parameters</p>
            <pre className="text-[11px] font-mono bg-muted/50 rounded-md px-3 py-2.5 overflow-x-auto leading-relaxed text-foreground whitespace-pre-wrap break-all">
              {JSON.stringify(job.payload, null, 2)}
            </pre>
          </div>

          {/* Replicable curl (everything except image jobs) */}
          {job.type === "image" ? (
            <p className="text-[10px] text-muted-foreground">Image jobs can’t be replicated as a curl (binary payload).</p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">curl</p>
                <button onClick={copyCurl}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-[color,transform] active:scale-[0.96]">
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="text-[11px] font-mono bg-muted/50 rounded-md px-3 py-2.5 overflow-x-auto leading-relaxed text-foreground whitespace-pre-wrap break-all">
                {jobCurl(job)}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {(job.status === "failed" || job.status === "cancelled") && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1.5" onClick={onRetry}>
                <RefreshCw size={11} /> Retry
              </Button>
            )}
            {job.status === "done" && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1.5" onClick={onReprint}>
                <PrinterIcon size={11} /> Re-print
              </Button>
            )}
            {job.status === "pending" && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1.5 text-destructive hover:text-destructive" onClick={onCancel}>
                <Ban size={11} /> Cancel
              </Button>
            )}
            {job.status !== "printing" && (
              confirmingDelete ? (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                  <span className="text-muted-foreground">Delete?</span>
                  <Button size="sm" variant="destructive" className="h-7 text-xs px-2.5" onClick={() => { setConfirmingDelete(false); onDelete(); }}>
                    Yes
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs px-2.5" onClick={() => setConfirmingDelete(false)}>
                    No
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 text-xs px-2.5 gap-1.5 text-muted-foreground hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 size={11} /> Delete
                </Button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground/40">
      <Icon size={28} strokeWidth={1.5} />
      <p className="text-xs">{message}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function QueuePage() {
  const initialJobs = Route.useLoaderData();
  const [jobs, setJobs]                     = useState<PrintJob[]>(initialJobs);
  const [selectionMode, setSelectionMode]   = useState(false);
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [expandedIds, setExpandedIds]     = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  const visibleJobs = jobs;

  const allChecked  = visibleJobs.length > 0 && visibleJobs.every(j => selectedIds.has(j.id));
  const someChecked = visibleJobs.some(j => selectedIds.has(j.id)) && !allChecked;
  const canRetry    = visibleJobs.some(j => selectedIds.has(j.id) && (j.status === "failed" || j.status === "cancelled"));
  const canReprint  = visibleJobs.some(j => selectedIds.has(j.id) && j.status === "done");
  const canCancel   = visibleJobs.some(j => selectedIds.has(j.id) && j.status === "pending");
  const canDelete   = visibleJobs.some(j => selectedIds.has(j.id) && j.status !== "printing");
  const allExpanded = visibleJobs.length > 0 && visibleJobs.every(j => expandedIds.has(j.id));

  useEffect(() => {
    let destroyed = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function applyMessage(msg: WatcherEvent) {
      switch (msg.event) {
        case "job:queued":
        case "job:printing":
        case "job:done":
        case "job:failed":
        case "job:cancelled":
          setJobs(prev => {
            const job = msg.job as PrintJob;
            const idx = prev.findIndex(j => j.id === job.id);
            if (idx >= 0) { const next = [...prev]; next[idx] = job; return next; }
            return [job, ...prev];
          });
          break;
        case "jobs:reset":
          setJobs(prev => {
            const map = new Map(prev.map(j => [j.id, j]));
            for (const j of msg.jobs as PrintJob[]) map.set(j.id, j);
            return [...map.values()].sort((a, b) => b.created_at - a.created_at);
          });
          break;
      }
    }

    async function connect() {
      if (destroyed) return;
      const url = await watchWsUrl();          // signed short-lived token (no admin key)
      if (destroyed || !url) {
        if (!destroyed) retryTimeout = setTimeout(connect, 3_000);
        return;
      }
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        // Re-fetch full state on every (re)connect — catches events missed while disconnected
        listJobs().then(setJobs).catch(console.error);
      };

      ws.onmessage = (event) => {
        applyMessage(JSON.parse(String(event.data)) as WatcherEvent);
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!destroyed) retryTimeout = setTimeout(connect, 3_000);
      };

      ws.onerror = () => {};
    }

    connect();
    return () => {
      destroyed = true;
      if (retryTimeout !== null) clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
  }, []);

  function toggleSelectAll() {
    if (allChecked) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleJobs.map(j => j.id)));
  }

  function toggleCheck(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandAll()   { setExpandedIds(new Set(visibleJobs.map(j => j.id))); }
  function collapseAll() { setExpandedIds(new Set()); }

  async function handleBulkRetry() {
    const ids = visibleJobs.filter(j => selectedIds.has(j.id) && (j.status === "failed" || j.status === "cancelled")).map(j => j.id);
    await Promise.all(ids.map(id => retryJob(id).catch(console.error)));
    setSelectedIds(new Set());
  }

  async function handleBulkReprint() {
    const ids = visibleJobs.filter(j => selectedIds.has(j.id) && j.status === "done").map(j => j.id);
    await Promise.all(ids.map(id => reprintJob(id).catch(console.error)));
    setSelectedIds(new Set());
  }

  async function handleBulkCancel() {
    const ids = visibleJobs.filter(j => selectedIds.has(j.id) && j.status === "pending").map(j => j.id);
    await Promise.all(ids.map(id => cancelJob(id).catch(console.error)));
    setSelectedIds(new Set());
  }

  async function handleDelete(id: string) {
    await deleteJob(id).catch(console.error);
    setJobs(prev => prev.filter(j => j.id !== id));
    setExpandedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function handleBulkDelete() {
    const ids = visibleJobs.filter(j => selectedIds.has(j.id) && j.status !== "printing").map(j => j.id);
    await Promise.all(ids.map(id => deleteJob(id).catch(console.error)));
    setJobs(prev => prev.filter(j => !ids.includes(j.id)));
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-border bg-secondary/40 h-12 flex items-center">
        <div className="max-w-4xl mx-auto w-full px-3 flex items-center gap-2">
          {selectionMode && (
            <Checkbox
              checked={allChecked ? true : someChecked ? "indeterminate" : false}
              onCheckedChange={toggleSelectAll}
            />
          )}

          <span className="text-sm font-medium flex-1">
            {(() => {
              const active = visibleJobs.filter(j => j.status === "pending" || j.status === "printing").length;
              if (visibleJobs.length === 0) return <span className="text-muted-foreground">Queue empty</span>;
              if (active > 0) return <span className="text-primary">{active} in queue</span>;
              return <span className="text-muted-foreground">{visibleJobs.length} job{visibleJobs.length !== 1 ? "s" : ""}</span>;
            })()}
          </span>

          <div className="flex items-center gap-1">
            {visibleJobs.length > 0 && !selectionMode && (
              <button
                onClick={allExpanded ? collapseAll : expandAll}
                title={allExpanded ? "Collapse all" : "Expand all"}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
              >
                {allExpanded ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
              </button>
            )}

            {selectionMode ? (
              <button
                onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
              >
                Done
              </button>
            ) : (
              <button
                onClick={() => setSelectionMode(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
              >
                <CheckSquare size={12} />
                Select
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk actions — full width */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="flex-shrink-0 border-b border-border bg-accent/20">
          <div className="max-w-4xl mx-auto w-full px-3 py-1.5 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
            <div className="flex items-center gap-1.5 ml-auto">
              {canRetry && (
                <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={handleBulkRetry}>
                  <RefreshCw size={11} /> Retry
                </Button>
              )}
              {canReprint && (
                <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={handleBulkReprint}>
                  <PrinterIcon size={11} /> Re-print
                </Button>
              )}
              {canCancel && (
                <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1 text-destructive hover:text-destructive" onClick={handleBulkCancel}>
                  <Ban size={11} /> Cancel
                </Button>
              )}
              {canDelete && (
                confirmBulkDelete ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Delete {selectedIds.size}?</span>
                    <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => { setConfirmBulkDelete(false); handleBulkDelete(); }}>Yes</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setConfirmBulkDelete(false)}>No</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1 text-destructive hover:text-destructive" onClick={() => setConfirmBulkDelete(true)}>
                    <Trash2 size={11} /> Delete
                  </Button>
                )
              )}
              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Job list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full px-3 py-2 space-y-1">
          {visibleJobs.length === 0 ? (
            <EmptyState icon={RefreshCw} message="No jobs yet" />
          ) : visibleJobs.map(job => (
            <JobRow
              key={job.id}
              job={job}
              checked={selectedIds.has(job.id)}
              expanded={expandedIds.has(job.id)}
              selectionMode={selectionMode}
              onCheck={() => toggleCheck(job.id)}
              onToggle={() => toggleExpand(job.id)}
              onRetry={() => retryJob(job.id).catch(console.error)}
              onReprint={() => reprintJob(job.id).catch(console.error)}
              onCancel={() => cancelJob(job.id).catch(console.error)}
              onDelete={() => handleDelete(job.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

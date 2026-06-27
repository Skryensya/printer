import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Lock, ShieldCheck, KeyRound, Copy, Check, Upload, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { getMyKey, type KeyInfo, type KeyCheck } from "~/api";
import { fetchSessionFn } from "~/session";

export const Route = createFileRoute("/docs")({ component: DocsPage });

// Which permission a print endpoint needs, derived from its path. Non-print
// endpoints return null (e.g. GET /jobs/:id, usable by any key).
function printPerm(path: string): string | null {
  return path.match(/^\/api\/v1\/print\/([a-z]+)$/)?.[1] ?? null;
}

// Whether the holder of `allowed` (a key's allowed_types; null = all) can use ep.
function keyCanUse(ep: Endpoint, allowed: string[] | null): boolean {
  if (ep.auth === "admin") return false;          // a service key is never admin
  const perm = printPerm(ep.path);
  if (!perm) return true;                          // service endpoint without a print type
  if (allowed === null) return true;               // unrestricted key
  if (perm === "message") return allowed.includes("message") || allowed.includes("message_custom");
  return allowed.includes(perm);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthLevel = "service" | "message" | "admin";
type FieldKind = "text" | "number" | "boolean" | "select" | "json" | "file";

interface Field {
  name:     string;
  type:     string;
  required: boolean;
  desc:     string;
  kind:     FieldKind;
  default?: string;
  options?: string[];
}

interface Endpoint {
  method:  "GET" | "POST" | "PATCH" | "DELETE";
  path:    string;
  auth:    AuthLevel;
  summary: string;
  body?:   Field[];
  query?:  Field[];
}

interface Section {
  title:     string;
  endpoints: Endpoint[];
}

// ─── Auth config ──────────────────────────────────────────────────────────────

const AUTH_RANK: Record<AuthLevel, number> = { service: 1, message: 1, admin: 2 };

const AUTH_META: Record<AuthLevel, {
  label: string; icon: React.ElementType;
  pill: string; row: string; desc: string; how: string;
}> = {
  service: {
    label: "API Key", icon: KeyRound,
    pill: "text-primary bg-primary/8 border-primary/25",
    row:  "bg-primary/4",
    desc: "Any valid API key. Keys can be restricted to specific job types and rate-limited.",
    how:  "X-API-Key: YOUR_KEY",
  },
  message: {
    label: "Message Key", icon: ShieldCheck,
    pill: "text-violet-600 bg-violet-500/8 border-violet-500/25",
    row:  "bg-violet-500/4",
    desc: 'Requires a key with "message" or "message_custom" in allowed_types. The sender name is locked to the key name unless the key has message_custom.',
    how:  "X-API-Key: YOUR_KEY  (with message permission)",
  },
  admin: {
    label: "Admin Key", icon: Lock,
    pill: "text-amber-600 bg-amber-500/8 border-amber-500/25",
    row:  "bg-amber-500/4",
    desc: "Requires ADMIN_API_KEY set in the server environment. Not stored in the database — configured at deploy time.",
    how:  "X-API-Key: ADMIN_KEY",
  },
};

// ─── Data ─────────────────────────────────────────────────────────────────────

const BASE_URL = (import.meta.env["VITE_API_URL"] ?? "https://printer-api.skryensya.dev").replace(/\/+$/, "");

const SECTIONS: Section[] = [
  {
    title: "Print",
    endpoints: [
      {
        method: "POST", path: "/api/v1/print/text", auth: "service",
        summary: "Print a line of plain text.",
        body: [
          { name: "text",   type: "string",                  required: true,  kind: "text",    default: "Hello world",  desc: "Content to print." },
          { name: "align",  type: '"left"|"center"|"right"', required: false, kind: "select",  default: "left",         desc: "Alignment.", options: ["left","center","right"] },
          { name: "bold",   type: "boolean",                 required: false, kind: "boolean", default: "",             desc: "Bold. Default: false." },
          { name: "size",   type: "1 | 2 | 3 | 4",          required: false, kind: "select",  default: "1",            desc: "Size multiplier (1–4).", options: ["1","2","3","4"] },
          { name: "invert", type: "boolean",                 required: false, kind: "boolean", default: "",             desc: "White-on-black. Default: false." },
        ],
      },
      {
        method: "POST", path: "/api/v1/print/ticket", auth: "service",
        summary: "Print a card with a header and body. Three modes: task card (badge + meta rows), message card (FROM sender), or QR card (QR code in the body).",
        body: [
          { name: "title", type: "string",             required: false, kind: "text", default: "Fix auth bug on Safari", desc: "Body text. Required unless qr is set." },
          { name: "badge", type: "string",             required: false, kind: "text", default: "HIGH",                  desc: 'Outlined pill in the header, e.g. "HIGH".' },
          { name: "from",  type: "string",             required: false, kind: "text", default: "",                      desc: "Sender name (message mode). Shown with a FROM label." },
          { name: "label", type: "string",             required: false, kind: "text", default: "TASK #042",             desc: "Primary header text. Shown alongside badge if set." },
          { name: "date",  type: "string",             required: false, kind: "text", default: "2026-06-20",            desc: "Right-aligned header text — date, time, any short string." },
          { name: "rows",  type: "[string, string][]", required: false, kind: "json", default: '[["Status","● DONE"],["Assigned","@allison"]]', desc: 'Key-value rows in the body.' },
          { name: "qr",    type: "string",             required: false, kind: "text", default: "",                      desc: "QR data. When set, body is a QR code and title shows below it." },
        ],
      },
      {
        method: "POST", path: "/api/v1/print/message", auth: "message",
        summary: 'Simplified message card. The sender is locked to the key name. Keys with "message_custom" permission can override it with body.from.',
        body: [
          { name: "message", type: "string", required: true,  kind: "text", default: "Deploy finished in 3m 12s", desc: "Message body text." },
          { name: "from",    type: "string", required: false, kind: "text", default: "",                          desc: "Sender override — only applied if the key has message_custom permission." },
        ],
      },
      {
        method: "POST", path: "/api/v1/print/todo", auth: "service",
        summary: "Print a checklist or shopping list. Items are rendered as ☐ rows with an optional right-aligned unit column. The emission date is printed automatically in the card header.",
        body: [
          { name: "items",  type: '(string | [name: string, unit: string])[]', required: true,  kind: "json", default: '[["Milk","2L"],["Eggs","12"],["Bread"]]', desc: 'Items to print as ☐ checkboxes. Each item is either a plain string or a [name, unit] tuple — unit appears right-aligned.' },
          { name: "title",  type: "string",   required: false, kind: "text", default: "Shopping List",           desc: "Header label on the card." },
          { name: "badge",  type: "string",   required: false, kind: "text", default: "",                        desc: 'Optional badge pill, e.g. "GROCERIES" or "WORK".' },
        ],
      },
      {
        method: "POST", path: "/api/v1/print/image", auth: "service",
        summary: "Print an image. Scaled to 384 px wide and converted to black-and-white. Pick a file below to generate the curl with the full base64.",
        body: [
          { name: "image",     type: "string (base64)", required: true,  kind: "file",   default: "",          desc: "Raw base64 image data — no data: URI prefix." },
          { name: "mediaType", type: "string",           required: false, kind: "select", default: "image/png", desc: "MIME type.", options: ["image/png","image/jpeg","image/gif","image/webp"] },
          { name: "effect",    type: '"photo"|"invert"', required: false, kind: "select", default: "photo",     desc: "Dither algorithm. photo = Atkinson + gamma boost.", options: ["photo","invert"] },
        ],
      },
    ],
  },
  {
    title: "Jobs",
    endpoints: [
      {
        method: "GET", path: "/api/v1/jobs", auth: "admin",
        summary: "List all jobs, newest first.",
        query: [
          { name: "status", type: '"pending"|"printing"|"done"|"failed"|"cancelled"', required: false, kind: "select", default: "", desc: "Filter to a single status.", options: ["pending","printing","done","failed","cancelled"] },
        ],
      },
      {
        method: "GET",  path: "/api/v1/jobs/:id",        auth: "service", summary: "Get a single job by ID. Any API key can poll job status.",
      },
      {
        method: "POST", path: "/api/v1/jobs/:id/retry",  auth: "admin",   summary: "Re-queue a done, failed, or cancelled job with its original payload.",
      },
      {
        method: "POST", path: "/api/v1/jobs/:id/cancel", auth: "admin",   summary: "Cancel a pending job. Has no effect if the job is already printing or done.",
      },
      {
        method: "DELETE", path: "/api/v1/jobs/:id",      auth: "admin",   summary: "Permanently delete a job. Cannot delete a job that is currently printing.",
      },
    ],
  },
  {
    title: "API Keys",
    endpoints: [
      {
        method: "GET", path: "/api/v1/keys", auth: "admin",
        summary: "List all API keys including revoked ones.",
      },
      {
        method: "POST", path: "/api/v1/keys", auth: "admin",
        summary: "Create a new API key. The raw key is only returned once — store it immediately.",
        body: [
          { name: "name",               type: "string",          required: true,  kind: "text", default: "my-integration",    desc: "Human-readable label." },
          { name: "rate_limit_per_min", type: "number | null",   required: false, kind: "number", default: "",               desc: "Max requests per minute. Omit for unlimited." },
          { name: "rate_limit_per_day", type: "number | null",   required: false, kind: "number", default: "",               desc: "Max requests per day. Omit for unlimited." },
          { name: "allowed_types",      type: "string[] | null", required: false, kind: "json", default: '["text","qr"]',    desc: 'Allowed job types. Use "message"/"message_custom" for /print/message. Omit for all types.' },
          { name: "expires_at",         type: "number",          required: false, kind: "number", default: "",               desc: "Unix timestamp for expiry. Omit for no expiry." },
        ],
      },
      {
        method: "PATCH", path: "/api/v1/keys/:id", auth: "admin",
        summary: "Update rate limits, expiry, or allowed types. Only provided fields are changed.",
        body: [
          { name: "rate_limit_per_min", type: "number | null",   required: false, kind: "number", default: "", desc: "New per-minute limit." },
          { name: "rate_limit_per_day", type: "number | null",   required: false, kind: "number", default: "", desc: "New per-day limit." },
          { name: "allowed_types",      type: "string[] | null", required: false, kind: "json",   default: "", desc: "New allowed types. null = all." },
          { name: "expires_at",         type: "number | null",   required: false, kind: "number", default: "", desc: "New expiry. null removes it." },
        ],
      },
      {
        method: "POST",   path: "/api/v1/keys/:id/revoke", auth: "admin", summary: "Revoke a key immediately. Rejected on the next request without a grace period.",
      },
      {
        method: "DELETE", path: "/api/v1/keys/:id",        auth: "admin", summary: "Permanently delete a key.",
      },
    ],
  },
  {
    title: "Status",
    endpoints: [
      {
        method: "GET", path: "/api/v1/agent", auth: "admin",
        summary: 'Agent and printer status. Values: "offline" (no agent), "printer_offline" (agent connected, printer not detected), "ready" (both ready).',
      },
      {
        method: "GET", path: "/health", auth: "admin",
        summary: "Liveness check.",
      },
    ],
  },
];

// ─── Curl builder ─────────────────────────────────────────────────────────────

function buildBodyObj(fields: Field[], vals: Record<string, string>, truncateFiles: boolean): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const f of fields) {
    const v = vals[f.name];
    if (v === undefined || v === "") continue;
    if (f.kind === "file" && truncateFiles) {
      obj[f.name] = `<base64 ${Math.round(v.length * 0.75 / 1024)} KB>`;
    } else if (f.kind === "boolean") {
      if (v === "true")  obj[f.name] = true;
      if (v === "false") obj[f.name] = false;
    } else if (f.kind === "number") {
      const n = parseFloat(v); if (!isNaN(n)) obj[f.name] = n;
    } else if (f.kind === "json") {
      try { obj[f.name] = JSON.parse(v); } catch { /* skip */ }
    } else {
      obj[f.name] = v;
    }
  }
  return obj;
}

function buildCurl(ep: Endpoint, vals: Record<string, string>, apiKey: string): string {
  const key = apiKey || "YOUR_KEY";
  const pathWithParams = ep.path.replace(/:([a-z_]+)/g, (_, p: string) => vals[p] || p.toUpperCase());
  const url = BASE_URL + pathWithParams;

  if (ep.method === "GET") {
    const qs = ep.query
      ?.filter(f => vals[f.name])
      .map(f => `${f.name}=${encodeURIComponent(vals[f.name]!)}`)
      .join("&");
    const fullUrl = qs ? `"${url}?${qs}"` : url;
    return `curl ${fullUrl} \\\n  -H "X-API-Key: ${key}"`;
  }

  const parts: string[] = [`curl -X ${ep.method} ${url}`, `-H "X-API-Key: ${key}"`];
  if (ep.body?.length) {
    parts.push(`-H "Content-Type: application/json"`);
    parts.push(`-d '${JSON.stringify(buildBodyObj(ep.body, vals, true))}'`);
  }
  return parts.map((p, i) => i === 0 ? p : `  ${p}`).join(" \\\n");
}

async function sendRequest(ep: Endpoint, vals: Record<string, string>, apiKey: string): Promise<string> {
  const key = apiKey || "";
  const pathWithParams = ep.path.replace(/:([a-z_]+)/g, (_, p: string) => vals[p] || "");
  const url = BASE_URL + pathWithParams;
  const headers: Record<string, string> = { "X-API-Key": key };
  let body: string | undefined;
  if (ep.body?.length) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(buildBodyObj(ep.body, vals, false));
  }
  const res = await fetch(url, { method: ep.method, headers, body });
  if (res.status === 204) return `HTTP ${res.status} No Content`;
  const json = await res.json() as Record<string, unknown>;
  return `HTTP ${res.status}\n${JSON.stringify(json, null, 2)}`;
}

function hasFileData(ep: Endpoint, vals: Record<string, string>): boolean {
  return (ep.body ?? []).some(f => f.kind === "file" && vals[f.name]);
}

// ─── Field input ──────────────────────────────────────────────────────────────

const INPUT_CLS = "w-full text-xs bg-background border border-border rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-primary/30 text-foreground";

function AutoTextarea({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={INPUT_CLS + " resize-none overflow-hidden leading-relaxed"}
      style={{ minHeight: "2rem" }}
    />
  );
}

function FieldInput({ field, value, onChange }: {
  field: Field; value: string; onChange: (v: string) => void;
}) {
  if (field.kind === "select") {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={INPUT_CLS + " cursor-pointer"}>
        {!field.required && <option value="">—</option>}
        {field.options!.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.kind === "boolean") {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={INPUT_CLS + " cursor-pointer"}>
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (field.kind === "number") {
    return <input type="number" value={value} onChange={e => onChange(e.target.value)} className={INPUT_CLS} />;
  }
  return <AutoTextarea value={value} onChange={onChange} placeholder={field.kind === "json" ? "JSON…" : field.required ? "(required)" : "—"} />;
}

function ImageFilePicker({ value, onChange, onMimeType }: {
  value: string;
  onChange: (base64: string) => void;
  onMimeType: (mime: string) => void;
}) {
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function clear() {
    setFileName("");
    onChange("");
    onMimeType("image/png");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label className="flex-1 flex items-center gap-1.5 cursor-pointer text-xs border border-border rounded px-2 py-1.5 bg-background hover:bg-accent/20 transition-colors min-w-0">
          <Upload size={10} className="text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground truncate">{fileName || "Choose image…"}</span>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            onMimeType(file.type || "image/png");
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              onChange(dataUrl.split(",")[1] ?? "");
            };
            reader.readAsDataURL(file);
          }} />
        </label>
        {value && (
          <button onClick={clear} className="flex-shrink-0 p-1.5 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors">
            <X size={10} />
          </button>
        )}
      </div>
      {value && (
        <p className="text-[10px] text-emerald-600 font-mono">
          {Math.round(value.length * 0.75 / 1024)} KB loaded
        </p>
      )}
    </div>
  );
}

// ─── Key info banner ──────────────────────────────────────────────────────────

const PERM_COLORS: Record<string, string> = {
  text:           "bg-blue-500/10 text-blue-700 border-blue-500/20",
  message:        "bg-violet-500/10 text-violet-700 border-violet-500/20",
  message_custom: "bg-violet-500/10 text-violet-700 border-violet-500/20",
  ticket:         "bg-primary/10 text-primary border-primary/20",
  todo:           "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  qr:             "bg-amber-500/10 text-amber-700 border-amber-500/20",
  image:          "bg-orange-500/10 text-orange-700 border-orange-500/20",
  borders:        "bg-muted text-muted-foreground border-border",
  test:           "bg-muted text-muted-foreground border-border",
};

function KeyInfoBanner({ info }: { info: KeyCheck | null | "loading" }) {
  if (!info) return null;

  if (info === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
        <span className="w-3 h-3 rounded-full bg-muted-foreground/30 animate-pulse" />
        Checking key…
      </div>
    );
  }

  if (info === "rejected") {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive">
        <AlertCircle size={13} />
        Invalid or expired key
      </div>
    );
  }

  if (info === "unreachable") {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-600">
        <AlertCircle size={13} />
        Couldn’t reach the API — check it’s running and the URL is right (not the key)
      </div>
    );
  }

  const rateMin = info.rate_limit_per_min;
  const rateDay = info.rate_limit_per_day;
  const expires = info.expires_at
    ? new Date(info.expires_at * 1000).toLocaleDateString()
    : null;

  return (
    <div className="rounded-md border border-primary/20 bg-primary/4 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={13} className="text-primary flex-shrink-0" />
        <span className="text-xs font-medium text-foreground">{info.name}</span>
        {expires && (
          <span className="ml-auto text-[10px] text-muted-foreground">expires {expires}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {info.allowed_types === null ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-primary/10 text-primary border-primary/20">
            all types
          </span>
        ) : (
          info.allowed_types.map(t => (
            <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PERM_COLORS[t] ?? "bg-muted text-muted-foreground border-border"}`}>
              {t}
            </span>
          ))
        )}
      </div>

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground [font-variant-numeric:tabular-nums]">
        <span>
          {rateMin != null ? `${rateMin}/min` : "∞/min"}
          {" · "}
          {rateDay != null ? `${rateDay}/day` : "∞/day"}
        </span>
      </div>
    </div>
  );
}

// ─── Endpoint card ────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET:    "text-white bg-emerald-600",
  POST:   "text-white bg-primary",
  PATCH:  "text-white bg-amber-500",
  DELETE: "text-white bg-destructive",
};

const AUTH_ACCENT_BG: Record<AuthLevel, string> = {
  service: "bg-primary/50",
  message: "bg-violet-500/50",
  admin:   "bg-amber-500/50",
};

function AuthPill({ auth }: { auth: AuthLevel }) {
  const m = AUTH_META[auth];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${m.pill}`}>
      <Icon size={9} />{m.label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
      <span className="inline-block w-2 h-px bg-border/80 rounded-full" />
      {children}
    </p>
  );
}

function EndpointCard({ ep, apiKey }: { ep: Endpoint; apiKey: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [sendResult, setSendResult] = useState("");

  const hasPathParam = ep.path.includes(":");
  const allFields = [...(ep.body ?? []), ...(ep.query ?? [])];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    if (hasPathParam) v["id"] = "";
    for (const f of allFields) v[f.name] = f.default ?? "";
    return v;
  });

  function setVal(name: string, val: string) {
    setValues(prev => ({ ...prev, [name]: val }));
  }

  async function copy() {
    await navigator.clipboard.writeText(buildCurl(ep, values, apiKey));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function send() {
    setSendState("sending");
    setSendResult("");
    try {
      const result = await sendRequest(ep, values, apiKey);
      setSendState("ok");
      setSendResult(result);
    } catch (e) {
      setSendState("error");
      setSendResult(e instanceof Error ? e.message : String(e));
    }
  }

  const fileLoaded = hasFileData(ep, values);
  const m = AUTH_META[ep.auth];
  const Icon = m.icon;

  return (
    <div className={`relative rounded-lg border overflow-hidden transition-[border-color,box-shadow] duration-200 ${open ? "border-border shadow-sm" : "border-border/50 hover:border-border/80"}`}>

      {/* Left accent strip */}
      <div className={`absolute left-0 inset-y-0 w-[2.5px] transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"} ${AUTH_ACCENT_BG[ep.auth]}`} />

      {/* Header row */}
      <button
        className="w-full text-left flex items-center gap-3 pl-4 pr-4 py-3 hover:bg-accent/20 transition-[background-color] active:bg-accent/30"
        onClick={() => setOpen(v => !v)}
      >
        <span className={`flex-shrink-0 text-[10px] font-bold font-mono w-16 text-center py-1 rounded-md tracking-wider ${METHOD_COLORS[ep.method]}`}>
          {ep.method}
        </span>
        <code className="flex-1 text-sm font-mono text-foreground truncate">{ep.path}</code>
        <AuthPill auth={ep.auth} />
        <ChevronDown size={13} className={`flex-shrink-0 text-muted-foreground/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Summary — always visible */}
      <div className="px-4 pb-3 -mt-1">
        <p className="text-xs text-muted-foreground leading-relaxed">{ep.summary}</p>
      </div>

      {/* Animated expanded body */}
      <div style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows 240ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}>
        <div className="overflow-hidden">
          <div className="border-t border-border/50 divide-y divide-border/40">

            {/* Auth */}
            <div className={`px-4 py-3 flex items-start gap-3 ${m.row}`}>
              <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center bg-background border border-border/60">
                <Icon size={11} className={m.pill.split(" ")[0]} />
              </div>
              <div>
                <p className="text-xs font-medium text-foreground">{m.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{m.desc}</p>
                <code className="text-[11px] text-muted-foreground/80 font-mono mt-1.5 block">{m.how}</code>
              </div>
            </div>

            {/* Path param (:id) */}
            {hasPathParam && (
              <div className="px-4 py-3">
                <SectionLabel>Path</SectionLabel>
                <div className="flex items-center gap-3">
                  <code className="text-xs font-mono text-muted-foreground w-16 flex-shrink-0">:id</code>
                  <input
                    type="text"
                    placeholder="paste job/key ID…"
                    value={values["id"] ?? ""}
                    onChange={e => setVal("id", e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
              </div>
            )}

            {/* Query params */}
            {ep.query && ep.query.length > 0 && (
              <div className="px-4 py-3">
                <SectionLabel>Query Parameters</SectionLabel>
                <FieldRows fields={ep.query} values={values} onChange={setVal} />
              </div>
            )}

            {/* Body */}
            {ep.body && ep.body.length > 0 && (
              <div className="px-4 py-3">
                <SectionLabel>
                  Request Body{" "}
                  <span className="normal-case font-normal text-muted-foreground/50 tracking-normal">(JSON)</span>
                </SectionLabel>
                <FieldRows fields={ep.body} values={values} onChange={setVal} />
              </div>
            )}

            {/* Live curl */}
            <div className="px-4 py-3 space-y-2 bg-muted/20">
              <div className="flex items-center justify-between">
                <SectionLabel>curl</SectionLabel>
                <div className="flex items-center gap-3 -mt-3">
                  <button
                    onClick={send}
                    disabled={sendState === "sending"}
                    className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/70 disabled:opacity-40 transition-colors"
                  >
                    {sendState === "sending" ? "Sending…" : "Send →"}
                  </button>
                  <button onClick={copy} className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    {copied ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <pre className="text-[11px] font-mono bg-background border border-border/60 rounded-md px-3 py-2.5 overflow-x-auto leading-relaxed text-foreground whitespace-pre-wrap break-all">
                {buildCurl(ep, values, apiKey)}
              </pre>
              {fileLoaded && (
                <p className="text-[10px] text-amber-600">
                  Image data is truncated in the curl example — use <strong>Send</strong> to run it directly from the browser.
                </p>
              )}
              {sendState !== "idle" && sendResult && (
                <pre className={`text-[11px] font-mono rounded-md px-3 py-2.5 whitespace-pre-wrap break-all border ${sendState === "ok" ? "bg-emerald-500/6 text-emerald-700 border-emerald-500/20" : "bg-destructive/6 text-destructive border-destructive/20"}`}>
                  {sendResult}
                </pre>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRows({ fields, values, onChange }: {
  fields: Field[];
  values: Record<string, string>;
  onChange: (name: string, val: string) => void;
}) {
  return (
    <div className="space-y-3">
      {fields.map(f => (
        <div key={f.name} className="grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: "8rem 1fr 10rem" }}>
          {/* Name + type */}
          <div className="pt-1">
            <code className="text-xs font-mono font-medium text-foreground">{f.name}</code>
            {f.required && <span className="text-destructive text-[10px] ml-0.5">*</span>}
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5 break-all leading-tight">{f.type}</div>
          </div>
          {/* Description */}
          <div className="pt-1.5">
            <p className="text-xs text-muted-foreground leading-snug">{f.desc}</p>
          </div>
          {/* Input */}
          <div>
            {f.kind === "file" ? (
              <ImageFilePicker
                value={values[f.name] ?? ""}
                onChange={v => onChange(f.name, v)}
                onMimeType={mime => onChange("mediaType", mime)}
              />
            ) : (
              <FieldInput field={f} value={values[f.name] ?? ""} onChange={v => onChange(f.name, v)} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const AUTH_FILTERS: { value: AuthLevel | "all"; label: string }[] = [
  { value: "all",     label: "All endpoints" },
  { value: "service", label: "API Key" },
  { value: "admin",   label: "Admin only" },
];

function DocsPage() {
  const [authFilter, setAuthFilter] = useState<AuthLevel | "all">("all");
  const [apiKey, setApiKey] = useState<string>(() => {
    try { return localStorage.getItem("docs:apiKey") ?? ""; } catch { return ""; }
  });
  const [keyInfo, setKeyInfo] = useState<KeyCheck | null | "loading">(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    fetchSessionFn().then(s => setAuthed(s.authenticated === true)).catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (!apiKey.trim()) { setKeyInfo(null); return; }
    setKeyInfo("loading");
    const timer = setTimeout(() => {
      getMyKey(apiKey.trim()).then(setKeyInfo);
    }, 500);
    return () => clearTimeout(timer);
  }, [apiKey]);

  // A validated key, or null. When present, docs show only what THIS key can do.
  const validKey: KeyInfo | null =
    keyInfo && keyInfo !== "loading" && keyInfo !== "rejected" && keyInfo !== "unreachable"
      ? keyInfo : null;

  // What to show:
  //  - valid key  → only the endpoints that key is allowed to use
  //  - no key, admin session → full reference
  //  - no key, public → nothing (prompt to paste a key)
  const visibleSections: Section[] = validKey
    ? SECTIONS
        .map(s => ({ ...s, endpoints: s.endpoints.filter(ep => keyCanUse(ep, validKey.allowed_types)) }))
        .filter(s => s.endpoints.length > 0)
    : authed
    ? SECTIONS
    : [];

  // The auth legend + filter only make sense in the full-reference (admin, no key) view.
  const showReference = !validKey && authed;

  function updateApiKey(v: string) {
    setApiKey(v);
    try {
      if (v) localStorage.setItem("docs:apiKey", v);
      else localStorage.removeItem("docs:apiKey");
    } catch {}
  }

  function visible(ep: Endpoint): boolean {
    if (authFilter === "all")     return true;
    if (authFilter === "admin")   return ep.auth === "admin";
    if (authFilter === "service") return AUTH_RANK[ep.auth] >= 1;
    return true;
  }

  return (
    <div className="min-h-full bg-background pb-12">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">API Reference</h1>
          <p className="text-sm text-muted-foreground">
            Base URL: <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground text-xs">{BASE_URL}</code>
            <span className="mx-2 text-border">·</span>
            Authenticate with <code className="font-mono bg-muted px-1 rounded text-foreground text-xs">X-API-Key</code>
          </p>
        </div>

        {/* API Key input + live info */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold block mb-1.5">
              Your API Key
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={e => updateApiKey(e.target.value)}
              placeholder="Paste your key to populate curls and see permissions…"
              className="w-full text-xs font-mono bg-background border border-border rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30 text-foreground"
            />
          </div>
          <KeyInfoBanner info={keyInfo} />
        </div>

        {/* Auth legend + filter — only in the full-reference view (admin, no key) */}
        {showReference && (
          <>
            <div>
              <h2 className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground mb-3">Authentication</h2>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(AUTH_META) as AuthLevel[]).map(level => {
                  const m = AUTH_META[level];
                  const Icon = m.icon;
                  return (
                    <div key={level} className={`rounded-lg border border-border p-3 ${m.row}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Icon size={12} className={m.pill.split(" ")[0]} />
                        <AuthPill auth={level} />
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">{m.desc}</p>
                      <code className="text-[11px] text-muted-foreground font-mono mt-1.5 block">{m.how}</code>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3 border-b border-border pb-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold shrink-0">Filter</span>
              <div className="flex gap-1 flex-wrap">
                {AUTH_FILTERS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setAuthFilter(f.value as AuthLevel | "all")}
                    className={[
                      "px-2.5 py-1 rounded-md text-xs transition-colors border",
                      authFilter === f.value
                        ? "bg-foreground text-background border-foreground font-medium"
                        : "text-muted-foreground border-border/60 hover:text-foreground hover:bg-accent hover:border-border",
                    ].join(" ")}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* When the key is set, a hint that the list is scoped to it */}
        {validKey && (
          <p className="text-xs text-muted-foreground border-b border-border pb-2">
            Showing the endpoints <span className="font-medium text-foreground">{validKey.name}</span> can use.
          </p>
        )}

        {/* Empty state — public visitor with no key entered */}
        {visibleSections.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Paste your API key above to see the endpoints it can use.
          </div>
        )}

        {/* Sections */}
        {visibleSections.map(section => {
          const eps = showReference ? section.endpoints.filter(visible) : section.endpoints;
          if (!eps.length) return null;
          return (
            <div key={section.title} className="space-y-1.5">
              <h2 className="text-xs uppercase tracking-widest font-semibold text-muted-foreground px-1 mb-2">{section.title}</h2>
              {eps.map(ep => (
                <EndpointCard key={ep.method + ep.path} ep={ep} apiKey={apiKey} />
              ))}
            </div>
          );
        })}

      </div>
    </div>
  );
}

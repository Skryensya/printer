import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KeyRound, Plus, ShieldOff, Trash2, Copy, Check, Pencil, CopyPlus, Infinity } from "lucide-react";
import { listKeys, createKey, updateKey, revokeKey, deleteKey, type ApiKey, ALL_PERMISSION_TYPES } from "~/api";
import { Checkbox } from "~/components/ui/checkbox";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";

export const Route = createFileRoute("/keys")({
  component: KeysPage,
});

function keyStatus(key: ApiKey): "active" | "revoked" | "expired" {
  if (key.revoked_at !== null) return "revoked";
  if (key.expires_at !== null && key.expires_at < Date.now() / 1000) return "expired";
  return "active";
}

const STATUS_STYLE: Record<"active"|"revoked"|"expired", string> = {
  active:  "bg-primary/10 text-primary border-primary/20",
  revoked: "bg-destructive/10 text-destructive border-destructive/20",
  expired: "bg-muted text-muted-foreground border-border",
};

function StatusPill({ status }: { status: "active"|"revoked"|"expired" }) {
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  );
}

// ─── Shared modal shell ───────────────────────────────────────────────────────

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: "rgba(0,0,0,0.3)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl p-7 w-full max-w-md"
        style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.06), 0 4px 6px rgba(0,0,0,0.04), 0 20px 48px rgba(0,0,0,0.13)" }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Quota fields (shared between create and edit) ────────────────────────────

function QuotaFields({
  perMin, perDay, onPerMin, onPerDay,
}: {
  perMin: string; perDay: string;
  onPerMin: (v: string) => void; onPerDay: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Quota</p>
        <p className="text-xs text-muted-foreground mt-0.5">Leave blank for unlimited.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="qf-permin">Per minute</Label>
          <Input id="qf-permin" type="number" min={1} value={perMin}
            onChange={e => onPerMin(e.target.value)} placeholder="∞"
            className="font-mono [font-variant-numeric:tabular-nums]" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qf-perday">Per day</Label>
          <Input id="qf-perday" type="number" min={1} value={perDay}
            onChange={e => onPerDay(e.target.value)} placeholder="∞"
            className="font-mono [font-variant-numeric:tabular-nums]" />
        </div>
      </div>
    </div>
  );
}

function parseLimit(val: string): number | null {
  const n = parseInt(val, 10);
  return val.trim() === "" || isNaN(n) || n <= 0 ? null : n;
}

const TYPE_LABELS: Record<string, string> = {
  text:           "Text",
  message:        "Message",
  message_custom: "Message · custom from",
  ticket:         "Ticket",
  todo:           "To-do / List",
  qr:             "QR Code",
  image:          "Image",
};

function TypeSelector({ value, onChange }: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  const checked = new Set(value ?? ALL_PERMISSION_TYPES);

  function toggle(type: string) {
    const next = new Set(checked);
    if (next.has(type)) next.delete(type); else next.add(type);
    if (next.size === 0) return;
    onChange(next.size === ALL_PERMISSION_TYPES.length ? null : [...next]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Allowed types</p>
        <button type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => onChange(null)}>
          Allow all
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {ALL_PERMISSION_TYPES.map(type => (
          <label key={type}
            className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer select-none">
            <Checkbox
              checked={checked.has(type)}
              onCheckedChange={() => toggle(type)}
              className="flex-shrink-0 mt-0.5" />
            <span className="text-sm leading-snug">{TYPE_LABELS[type] ?? type}</span>
          </label>
        ))}
      </div>
      {value !== null && (
        <p className="text-[11px] text-muted-foreground">
          {value.length} of {ALL_PERMISSION_TYPES.length} types allowed
        </p>
      )}
    </div>
  );
}

function toDateInput(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

// ─── New key modal ────────────────────────────────────────────────────────────

interface KeyParams {
  expires_at?: number | null;
  rate_limit_per_min?: number | null;
  rate_limit_per_day?: number | null;
  allowed_types?: string[] | null;
}

function NewKeyModal({ onClose, onCreated, initial }: {
  onClose: () => void;
  onCreated: (name: string, raw: string) => void;
  initial?: KeyParams;
}) {
  const [name, setName]             = useState("");
  const [expires, setExpires]       = useState(toDateInput(initial?.expires_at ?? null));
  const [perMin, setPerMin]         = useState(initial?.rate_limit_per_min != null ? String(initial.rate_limit_per_min) : "");
  const [perDay, setPerDay]         = useState(initial?.rate_limit_per_day != null ? String(initial.rate_limit_per_day) : "");
  const [allowedTypes, setAllowedTypes] = useState<string[] | null>(initial?.allowed_types ?? null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const { raw } = await createKey({
        name:               name.trim(),
        expires_at:         expires ? Math.floor(new Date(expires).getTime() / 1000) : undefined,
        rate_limit_per_min: parseLimit(perMin),
        rate_limit_per_day: parseLimit(perDay),
        allowed_types:      allowedTypes,
      });
      onCreated(name.trim(), raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
      setLoading(false);
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <KeyRound size={16} className="text-primary" />
          </div>
          <div className="pt-0.5">
            <h2 className="text-base font-semibold" style={{ textWrap: "balance" } as React.CSSProperties}>
              {initial ? "Duplicate key" : "New service key"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              The raw key is shown once — store it somewhere safe.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nk-name">Name</Label>
          <Input id="nk-name" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. home-assistant" required autoFocus />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="nk-expires">Expiration</Label>
            <span className="text-[11px] text-muted-foreground">optional</span>
          </div>
          <Input id="nk-expires" type="date" value={expires} onChange={e => setExpires(e.target.value)} />
        </div>

        <Separator />
        <QuotaFields perMin={perMin} perDay={perDay} onPerMin={setPerMin} onPerDay={setPerDay} />
        <Separator />
        <TypeSelector value={allowedTypes} onChange={setAllowedTypes} />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1 h-9" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 h-9" disabled={loading || !name.trim()}>
            {loading ? "Creating…" : "Create key"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Edit key modal ───────────────────────────────────────────────────────────

function EditKeyModal({ apiKey, onClose, onSaved }: {
  apiKey: ApiKey;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [expires, setExpires]           = useState(toDateInput(apiKey.expires_at));
  const [perMin, setPerMin]             = useState(apiKey.rate_limit_per_min != null ? String(apiKey.rate_limit_per_min) : "");
  const [perDay, setPerDay]             = useState(apiKey.rate_limit_per_day != null ? String(apiKey.rate_limit_per_day) : "");
  const [allowedTypes, setAllowedTypes] = useState<string[] | null>(apiKey.allowed_types);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await updateKey(apiKey.id, {
        expires_at:         expires ? Math.floor(new Date(expires).getTime() / 1000) : null,
        rate_limit_per_min: parseLimit(perMin),
        rate_limit_per_day: parseLimit(perDay),
        allowed_types:      allowedTypes,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update key");
      setLoading(false);
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Pencil size={15} className="text-primary" />
          </div>
          <div className="pt-0.5">
            <h2 className="text-base font-semibold">{apiKey.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Edit expiration, quota, and allowed types. The key itself doesn't change.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="ek-expires">Expiration</Label>
            {expires && (
              <button type="button" onClick={() => setExpires("")}
                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors">
                Remove
              </button>
            )}
          </div>
          <Input id="ek-expires" type="date" value={expires} onChange={e => setExpires(e.target.value)} />
        </div>

        <Separator />
        <QuotaFields perMin={perMin} perDay={perDay} onPerMin={setPerMin} onPerDay={setPerDay} />
        <Separator />
        <TypeSelector value={allowedTypes} onChange={setAllowedTypes} />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1 h-9" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 h-9" disabled={loading}>
            {loading ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Key reveal modal ─────────────────────────────────────────────────────────

function KeyRevealModal({ name, raw, onClose }: { name: string; raw: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <KeyRound size={15} className="text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Key created</h2>
            <p className="text-xs text-muted-foreground">Copy it now — won't be shown again</p>
          </div>
        </div>

        <div className="bg-muted rounded-lg p-3 font-mono text-xs break-all select-all border border-border">
          {raw}
        </div>

        <p className="text-xs text-muted-foreground">
          This is the only time <strong className="text-foreground">{name}</strong>'s key will be shown.
          Store it somewhere safe.
        </p>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 gap-2" onClick={handleCopy}>
            {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
          </Button>
          <Button className="flex-1" onClick={onClose}>Done</Button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Key row ──────────────────────────────────────────────────────────────────

function KeyRow({ apiKey, onEdit, onDuplicate, onRevoke, onDelete }: {
  apiKey: ApiKey;
  onEdit: () => void;
  onDuplicate: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const status  = keyStatus(apiKey);
  const created = new Date(apiKey.created_at * 1000).toLocaleDateString();
  const expires = apiKey.expires_at
    ? new Date(apiKey.expires_at * 1000).toLocaleDateString()
    : null;

  const quota = apiKey.rate_limit_per_min !== null || apiKey.rate_limit_per_day !== null
    ? `${apiKey.rate_limit_per_min ?? "∞"}/min · ${apiKey.rate_limit_per_day ?? "∞"}/day`
    : "Unlimited";

  const restrictedTypes = apiKey.allowed_types;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors group">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-secondary flex items-center justify-center flex-shrink-0">
            <KeyRound size={13} className="text-muted-foreground" />
          </div>
          <span className="font-medium text-sm">{apiKey.name}</span>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <StatusPill status={status} />
      </td>
      <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
        {quota}
      </td>
      <td className="px-4 py-3.5 text-xs text-muted-foreground">
        {restrictedTypes === null ? (
          <span className="text-muted-foreground/40">All types</span>
        ) : (
          <div className="space-y-0.5">
            {restrictedTypes.map(t => (
              <div key={t} className="flex items-start gap-1.5">
                <span className="flex-shrink-0 text-primary mt-px">✓</span>
                <span className="leading-snug">{TYPE_LABELS[t] ?? t}</span>
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3.5 text-xs [font-variant-numeric:tabular-nums]">
        {apiKey.enqueued === 0 ? (
          <span className="text-muted-foreground/40">—</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-emerald-600" title="Printed">✓ {apiKey.printed}</span>
            {apiKey.failed > 0 && <span className="text-destructive" title="Failed">✗ {apiKey.failed}</span>}
            <span className="text-muted-foreground/50" title="Enqueued">/ {apiKey.enqueued}</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3.5 text-xs text-muted-foreground">
        {expires ?? <span className="text-muted-foreground/40">Never</span>}
      </td>
      <td className="px-4 py-3.5 text-xs text-muted-foreground">
        {created}
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          {status !== "revoked" && (
            <button title="Edit" onClick={onEdit}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <Pencil size={13} />
            </button>
          )}
          <button title="Duplicate" onClick={onDuplicate}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <CopyPlus size={13} />
          </button>
          {status === "active" && (
            <button title="Revoke" onClick={onRevoke}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-destructive transition-colors">
              <ShieldOff size={13} />
            </button>
          )}
          <button title="Delete" onClick={onDelete}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Modal =
  | { type: "new"; initial?: KeyParams }
  | { type: "edit"; key: ApiKey }
  | { type: "reveal"; name: string; raw: string };

function KeysPage() {
  const [keys, setKeys]     = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]   = useState<Modal | null>(null);

  async function load() {
    setLoading(true);
    try { setKeys(await listKeys()); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function handleCreated(name: string, raw: string) {
    setModal({ type: "reveal", name, raw });
    load();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">API Keys</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage service access to the printer API
            </p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setModal({ type: "new" })}>
            <Plus size={13} /> New key
          </Button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground/50">
              <KeyRound size={28} strokeWidth={1.5} />
              <p className="text-sm">No keys yet. Create one to connect a service.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/40">
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Rate limit</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Types</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Usage</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Expires</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <KeyRow
                    key={k.id}
                    apiKey={k}
                    onEdit={() => setModal({ type: "edit", key: k })}
                    onDuplicate={() => setModal({ type: "new", initial: {
                      expires_at:         k.expires_at,
                      rate_limit_per_min: k.rate_limit_per_min,
                      rate_limit_per_day: k.rate_limit_per_day,
                    }})}
                    onRevoke={async () => { await revokeKey(k.id).catch(console.error); load(); }}
                    onDelete={async () => { await deleteKey(k.id).catch(console.error); load(); }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal?.type === "new" && (
        <NewKeyModal
          initial={modal.initial}
          onClose={() => setModal(null)}
          onCreated={handleCreated}
        />
      )}
      {modal?.type === "edit" && (
        <EditKeyModal
          apiKey={modal.key}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
      {modal?.type === "reveal" && (
        <KeyRevealModal
          name={modal.name}
          raw={modal.raw}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listKeys, createKey, revokeKey, deleteKey, type ApiKey } from "~/api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";

export const Route = createFileRoute("/keys")({
  component: KeysPage,
});

function keyStatus(key: ApiKey): "active" | "revoked" | "expired" {
  if (key.revoked_at !== null) return "revoked";
  if (key.expires_at !== null && key.expires_at < Date.now() / 1000) return "expired";
  return "active";
}

const STATUS_VARIANT: Record<"active"|"revoked"|"expired", "default"|"secondary"|"destructive"> = {
  active:  "default",
  revoked: "destructive",
  expired: "secondary",
};

function KeyRow({ apiKey, onRevoke, onDelete }: {
  apiKey: ApiKey;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const status  = keyStatus(apiKey);
  const created = new Date(apiKey.created_at * 1000).toLocaleDateString();
  const expires = apiKey.expires_at
    ? new Date(apiKey.expires_at * 1000).toLocaleDateString()
    : "Never";

  return (
    <div className="flex items-center justify-between py-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{apiKey.name}</span>
          <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Created {created} · Expires {expires}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {status === "active" && (
          <Button size="sm" variant="outline" onClick={onRevoke}>Revoke</Button>
        )}
        <Button size="sm" variant="destructive" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  );
}

function NewKeyModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (name: string, raw: string) => void;
}) {
  const [name, setName]         = useState("");
  const [expires, setExpires]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const expiresAt = expires ? Math.floor(new Date(expires).getTime() / 1000) : undefined;
      const { raw } = await createKey(name.trim(), expiresAt);
      onCreated(name.trim(), raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
        <h2 className="text-base font-semibold">New API key</h2>
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. home-assistant"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Expires (optional)</Label>
          <Input
            type="date"
            value={expires}
            onChange={e => setExpires(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1" disabled={loading || !name.trim()}>
            {loading ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function KeyRevealModal({ name, raw, onClose }: { name: string; raw: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
        <h2 className="text-base font-semibold">Key created — copy it now</h2>
        <p className="text-sm text-muted-foreground">
          This is the only time <strong>{name}</strong>'s key will be shown.
        </p>
        <div className="bg-muted rounded-md p-3 font-mono text-xs break-all select-all">
          {raw}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button className="flex-1" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function KeysPage() {
  const [keys, setKeys]           = useState<ApiKey[]>([]);
  const [showNew, setShowNew]     = useState(false);
  const [revealed, setRevealed]   = useState<{ name: string; raw: string } | null>(null);
  const [loading, setLoading]     = useState(true);

  async function load() {
    setLoading(true);
    try { setKeys(await listKeys()); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function handleCreated(name: string, raw: string) {
    setShowNew(false);
    setRevealed({ name, raw });
    load();
  }

  async function handleRevoke(id: string) {
    await revokeKey(id).catch(console.error);
    load();
  }

  async function handleDelete(id: string) {
    await deleteKey(id).catch(console.error);
    load();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">API Keys</h1>
            <p className="text-sm text-muted-foreground">Manage service access to the printer API</p>
          </div>
          <Button size="sm" onClick={() => setShowNew(true)}>New key</Button>
        </div>

        <Separator />

        {loading
          ? <p className="text-sm text-muted-foreground">Loading…</p>
          : keys.length === 0
          ? <p className="text-sm text-muted-foreground py-8 text-center">No keys yet. Create one to connect a service.</p>
          : <div className="divide-y divide-border">
              {keys.map(k => (
                <KeyRow
                  key={k.id}
                  apiKey={k}
                  onRevoke={() => handleRevoke(k.id)}
                  onDelete={() => handleDelete(k.id)}
                />
              ))}
            </div>
        }
      </div>

      {showNew && (
        <NewKeyModal
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}

      {revealed && (
        <KeyRevealModal
          name={revealed.name}
          raw={revealed.raw}
          onClose={() => { setRevealed(null); }}
        />
      )}
    </div>
  );
}

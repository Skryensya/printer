import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Users, Plus, Trash2, Loader2, TimerReset } from "lucide-react";
import { listWallUsers, createWallUser, deleteWallUser, resetWallCooldowns, type WallUser } from "~/api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export const Route = createFileRoute("/wall-users")({
  component: WallUsersPage,
});

function NewUserForm({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await createWallUser({ username, password, display_name: displayName || undefined });
      setUsername(""); setDisplayName(""); setPassword("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-medium">New wall account</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="u" className="text-xs text-muted-foreground">Username</Label>
          <Input id="u" value={username} onChange={e => setUsername(e.target.value)}
            placeholder="ana" autoCapitalize="none" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d" className="text-xs text-muted-foreground">Display name</Label>
          <Input id="d" value={displayName} onChange={e => setDisplayName(e.target.value)}
            placeholder="Ana (defaults to username)" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p" className="text-xs text-muted-foreground">Password</Label>
          <Input id="p" value={password} onChange={e => setPassword(e.target.value)}
            type="password" placeholder="≥ 6 chars" disabled={busy} />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={busy || !username || password.length < 6} className="gap-1.5">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Create account
      </Button>
    </form>
  );
}

// Testing aid: wipes the wall's 30-min per-IP cooldowns so you can fire repeated
// test pings without waiting one out.
function ResetCooldowns() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function reset() {
    setBusy(true); setMsg(null);
    try {
      const cleared = await resetWallCooldowns();
      setMsg({ kind: "ok", text: cleared === null ? "Cooldowns reseteados" : `Reseteados ${cleared} cooldown${cleared === 1 ? "" : "s"}` });
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "No se pudo resetear" });
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3 flex-wrap">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Reset cooldowns del wall</p>
        <p className="text-xs text-muted-foreground">Borra los timeouts de 30 min por IP, para testear pings sin esperar.</p>
      </div>
      <div className="ml-auto flex items-center gap-2.5">
        {msg && (
          <span className={`text-xs ${msg.kind === "ok" ? "text-muted-foreground" : "text-destructive"}`}>{msg.text}</span>
        )}
        <Button size="sm" variant="secondary" onClick={reset} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <TimerReset size={14} />}
          Resetear
        </Button>
      </div>
    </div>
  );
}

function WallUsersPage() {
  const [users, setUsers] = useState<WallUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = () => listWallUsers().then(setUsers).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);

  async function handleDelete(username: string) {
    setConfirming(null);
    await deleteWallUser(username).catch(console.error);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-2.5">
          <Users size={18} className="text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Wall accounts</h1>
          <span className="ml-auto text-xs text-muted-foreground">
            People with an account skip the wall's rate limit and post under a fixed name.
          </span>
        </div>

        <ResetCooldowns />

        <NewUserForm onCreated={refresh} />

        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Display name</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground/50 text-sm">No accounts yet.</td></tr>
              ) : users.map(u => (
                <tr key={u.username} className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-3">{u.display_name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.created_at * 1000).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    {confirming === u.username ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Delete?</span>
                        <Button size="sm" variant="destructive" className="h-7 px-2.5 text-xs" onClick={() => handleDelete(u.username)}>Yes</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => setConfirming(null)}>No</Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs gap-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirming(u.username)}>
                        <Trash2 size={11} /> Delete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

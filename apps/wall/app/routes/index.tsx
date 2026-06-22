import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { Printer, Loader2 } from "lucide-react";
import { fetchWallFn, submitMessageFn, type WallSnapshot, type WallItem } from "~/api";
import { getRecaptchaToken } from "~/lib/recaptcha";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";

const MAX = 240;

export const Route = createFileRoute("/")({
  loader: () => fetchWallFn(),
  component: WallPage,
});

function formatCooldown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_STYLE: Record<WallItem["status"], string> = {
  pending:  "text-amber-600",
  printing: "text-primary",
  printed:  "text-muted-foreground",
  failed:   "text-destructive",
};

function WallPage() {
  const initial = Route.useLoaderData() as WallSnapshot;

  const [snapshot, setSnapshot] = useState<WallSnapshot>(initial);
  const [message, setMessage]   = useState("");
  const [from, setFrom]         = useState("");
  const [website, setWebsite]   = useState(""); // honeypot
  const [error, setError]       = useState("");
  const [sending, setSending]   = useState(false);
  const [cooldown, setCooldown] = useState(initial.cooldownRemaining);

  const mountedAt = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await fetchWallFn();
      setSnapshot(next);
      // Server is the source of truth: it releases the cooldown if a print fails.
      setCooldown(next.cooldownRemaining);
    } catch { /* keep last snapshot */ }
  }, []);

  // Poll the wall.
  useEffect(() => {
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  // Local cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1000)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const remaining = MAX - message.length;
  const onCooldown = cooldown > 0;
  const canSend = !sending && !onCooldown && message.trim().length > 0 && remaining >= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const token = await getRecaptchaToken("submit");
      const result = await submitMessageFn({
        data: {
          message,
          from,
          website,
          recaptchaToken: token,
          elapsedMs: Date.now() - mountedAt.current,
        },
      });
      if (result.ok) {
        setMessage("");
        setFrom("");
        setCooldown(result.cooldownRemaining);
        await refresh();
      } else {
        setError(result.error);
        if (result.cooldownRemaining) setCooldown(result.cooldownRemaining);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-xl space-y-8">

        {/* Header */}
        <header className="flex items-center gap-2">
          <Printer size={18} className="text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Printer Wall</h1>
          <span className="ml-auto text-xs text-muted-foreground">
            {snapshot.pending > 0 ? `${snapshot.pending} in queue` : "idle"}
          </span>
        </header>

        {/* Composer */}
        <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="space-y-1.5">
            <Label htmlFor="from">Name</Label>
            <Input id="from" value={from} onChange={e => setFrom(e.target.value)}
              placeholder="anon" maxLength={24} disabled={sending || onCooldown} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="message">Message</Label>
              <span className={`text-xs [font-variant-numeric:tabular-nums] ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {remaining}
              </span>
            </div>
            <Textarea id="message" value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Say something — it prints on real paper." rows={3}
              disabled={sending || onCooldown} />
          </div>

          {/* Honeypot — visually hidden, off-screen, not focusable. Bots fill it. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden" >
            <label>
              Website
              <input type="text" tabIndex={-1} autoComplete="off" value={website}
                onChange={e => setWebsite(e.target.value)} />
            </label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {onCooldown
                ? `One message per visitor — try again in ${formatCooldown(cooldown)}`
                : "One message per visitor every 30 minutes."}
            </p>
            <Button type="submit" disabled={!canSend} className="gap-1.5">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              {sending ? "Sending…" : "Print it"}
            </Button>
          </div>
        </form>

        {/* Wall */}
        <section className="space-y-2">
          {snapshot.items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nothing yet. Be the first to print something.
            </p>
          ) : (
            snapshot.items.map(item => (
              <article key={item.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">{item.from}</span>
                  <span className={`ml-auto text-[10px] uppercase tracking-wide ${STATUS_STYLE[item.status]}`}>
                    {item.status}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">{item.message}</p>
              </article>
            ))
          )}
        </section>

      </div>
    </div>
  );
}

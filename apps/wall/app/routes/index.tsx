import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { Printer, Loader2, Sun, Moon } from "lucide-react";
import { fetchWallFn, submitMessageFn, type WallSnapshot } from "~/api";
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

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("wall:theme", next ? "dark" : "light"); } catch {}
  }
  return (
    <button onClick={toggle} aria-label="Cambiar tema"
      className="w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-[color,background-color,transform] active:scale-[0.96]">
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

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

  // Remember the visitor's name across visits.
  useEffect(() => {
    try { const w = localStorage.getItem("wall:who"); if (w) setFrom(w); } catch {}
  }, []);

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
        // Keep the name for next time; only clear the message.
        try { if (from.trim()) localStorage.setItem("wall:who", from.trim()); } catch {}
        setMessage("");
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
    <div className="min-h-screen flex flex-col items-center px-5 py-16 sm:py-24">
      <div className="w-full max-w-lg space-y-12">

        {/* Header */}
        <header className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
              <Printer size={15} />
              <span>la impresora de Allison</span>
            </div>
            <ThemeToggle />
          </div>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] tracking-tight">
            Mándame algo.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground max-w-md">
            Escríbelo aquí y, cuando le des a imprimir, sale en papel en la
            impresora que tengo en mi escritorio. Lo voy a leer.
          </p>
        </header>

        {/* Composer */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="from" className="text-xs text-muted-foreground">Tu nombre</Label>
            <Input id="from" value={from} onChange={e => setFrom(e.target.value)}
              placeholder="anónimo" maxLength={24} disabled={sending || onCooldown}
              className="bg-input-bg" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="message" className="text-xs text-muted-foreground">Mensaje</Label>
              <span className={`text-xs [font-variant-numeric:tabular-nums] ${remaining < 0 ? "text-destructive" : "text-muted-foreground/70"}`}>
                {remaining}
              </span>
            </div>
            <Textarea id="message" value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Di algo — se imprime en papel de verdad." rows={4}
              disabled={sending || onCooldown}
              className="bg-input-bg resize-none leading-relaxed" />
          </div>

          {/* Honeypot — visually hidden, off-screen, not focusable. Bots fill it. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input type="text" tabIndex={-1} autoComplete="off" value={website}
                onChange={e => setWebsite(e.target.value)} />
            </label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-4 pt-1">
            <p className="text-xs text-muted-foreground/80 leading-snug">
              {onCooldown
                ? `Un mensaje por visitante. Vuelve en ${formatCooldown(cooldown)}.`
                : "Un mensaje por visitante cada 30 minutos."}
            </p>
            <Button type="submit" disabled={!canSend} size="lg"
              className="gap-2 rounded-full px-5 shrink-0 transition-[transform,background-color] active:scale-[0.96]">
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
              {sending ? "Enviando…" : "Imprimir"}
            </Button>
          </div>
        </form>

        {/* Your own messages — nobody sees anyone else's */}
        {snapshot.items.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-sm tracking-wide text-muted-foreground">Lo que has enviado</h2>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-2.5">
              {snapshot.items.map(item => (
                <article key={item.id}
                  className="rounded-xl border border-border bg-card px-4 py-3.5">
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{item.message}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground/70">— {item.from}</p>
                </article>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground/60 text-center pt-1">
              Solo tú ves tus mensajes. Se imprimen en mi escritorio.
            </p>
          </section>
        )}

        <footer className="pt-4 text-center">
          <a href="https://allison.sh" className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors">
            allison.sh
          </a>
        </footer>

      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { Printer, Loader2, Sun, Moon, LogOut, ArrowUp, ImagePlus, X as XIcon } from "lucide-react";
import { fetchWallFn, submitMessageFn, type WallSnapshot } from "~/api";
import { loginFn, logoutFn } from "~/session";
import { getRecaptchaToken } from "~/lib/recaptcha";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";

const MAX = 240;

export const Route = createFileRoute("/")({
  loader: () => fetchWallFn(),
  component: PingPage,
});

function formatCooldown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60)    return "ahora";
  if (s < 3600)  return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

// ─── Brand mark: a dot emitting signal rings (a "ping") ───────────────────────

function PulseMark({ size = 12, shoot = false }: { size?: number; shoot?: boolean }) {
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <span className="ping-rings absolute inset-0">
        <span /><span /><span />
      </span>
      {shoot && <span className="ping-shoot absolute inset-0 rounded-full border-[1.5px] border-ring" />}
      <span className="ping-dot relative rounded-full bg-foreground" style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

// ─── Circular character counter ───────────────────────────────────────────────

function CharRing({ used }: { used: number }) {
  const R = 11, C = 2 * Math.PI * R;
  const pct = Math.min(used / MAX, 1);
  const over = used > MAX;
  const offset = C * (1 - pct);
  const color = over
    ? "var(--destructive)"
    : pct > 0.85
    ? "var(--color-amber)"
    : "var(--muted-foreground)";
  const left = MAX - used;
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: 28, height: 28 }}>
      <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
        <circle cx="14" cy="14" r={R} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle
          cx="14" cy="14" r={R} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.2s ease, stroke 0.2s ease" }}
        />
      </svg>
      {(over || left <= 32) && (
        <span
          className="absolute text-[9px] font-medium [font-variant-numeric:tabular-nums]"
          style={{ color: over ? "var(--destructive)" : "var(--muted-foreground)" }}
        >
          {left}
        </span>
      )}
    </span>
  );
}

// ─── Connection status pill ───────────────────────────────────────────────────

function StatusPill({ online }: { online: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="relative flex h-1.5 w-1.5">
        {online && (
          <span
            className="absolute inline-flex h-full w-full rounded-full opacity-60"
            style={{ background: "var(--color-green)", animation: "ping-ring 2s ease-out infinite" }}
          />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: online ? "var(--color-green)" : "var(--muted-foreground)" }}
        />
      </span>
      {online ? "impresora en línea" : "reconectando…"}
    </span>
  );
}

// ─── Theme toggle ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("ping:theme", next ? "dark" : "light"); } catch {}
  }
  return (
    <button onClick={toggle} aria-label="Cambiar tema"
      className="w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-[color,background-color,transform] active:scale-[0.94]">
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

// ─── Login (anonymous only) ───────────────────────────────────────────────────

function LoginPanel({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [busy, setBusy]         = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await loginFn({ data: { username, password } });
      if (r.ok) onDone();
      else setError(r.error ?? "No se pudo iniciar sesión");
    } catch { setError("No se pudo iniciar sesión"); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="ping-rise space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[13px] text-muted-foreground leading-relaxed">
        Inicia sesión para mandar pings sin límite. Las cuentas las doy yo — no hay registro.
      </p>
      <Input value={username} onChange={e => setUsername(e.target.value)}
        placeholder="usuario" autoCapitalize="none" disabled={busy} className="bg-input-bg" />
      <Input value={password} onChange={e => setPassword(e.target.value)}
        type="password" placeholder="contraseña" disabled={busy} className="bg-input-bg" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !username || !password} size="sm" className="rounded-full px-4">
          {busy ? <Loader2 size={14} className="animate-spin" /> : "Entrar"}
        </Button>
        <button type="button" onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground">
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ─── A printed ping, styled as a tear-off receipt slip ────────────────────────

function PingSlip({ message, from, createdAt, delay, hasImage }: {
  message: string; from: string; createdAt: number; delay: number; hasImage: boolean;
}) {
  return (
    <article
      className="ping-rise relative rounded-2xl border border-border bg-card px-5 pt-4 pb-3 shadow-sm"
      style={{ animationDelay: `${delay}ms` }}
    >
      {message && <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{message}</p>}
      {hasImage && (
        <p className={`inline-flex items-center gap-1.5 text-[12px] text-muted-foreground ${message ? "mt-2" : ""}`}>
          <ImagePlus size={13} /> con foto
        </p>
      )}

      {/* perforation with ticket notches */}
      <div className="relative my-3">
        <hr className="perf" />
        <span className="absolute -left-5 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background border border-border" />
        <span className="absolute -right-5 top-1/2 h-3 w-3 translate-x-1/2 -translate-y-1/2 rounded-full bg-background border border-border" />
      </div>

      <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground/80">
        <span>— {from}</span>
        <span className="[font-variant-numeric:tabular-nums]">{timeAgo(createdAt)}</span>
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PingPage() {
  const initial = Route.useLoaderData() as WallSnapshot;

  const [snapshot, setSnapshot] = useState<WallSnapshot>(initial);
  const [message, setMessage]   = useState("");
  const [from, setFrom]         = useState("");
  const [website, setWebsite]   = useState(""); // honeypot
  const [error, setError]       = useState("");
  const [sending, setSending]   = useState(false);
  const [cooldown, setCooldown] = useState(initial.cooldownRemaining);
  const [showLogin, setShowLogin] = useState(false);
  const [online, setOnline]     = useState(true);
  const [justPinged, setJustPinged] = useState(false); // fires the success ripple
  // Attached photo (logged-in only): preview = data URL for <img>, data = base64 payload.
  const [photo, setPhoto] = useState<{ preview: string; data: string; mediaType: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const user = snapshot.user;            // logged-in account name, or null
  const mountedAt = useRef(Date.now());

  // Downscale a picked image to 384px wide (printer width) and keep it as base64.
  async function pickPhoto(file: File) {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const W = 384;
    const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    const png = canvas.toDataURL("image/png");
    setPhoto({ preview: png, data: png.split(",")[1] ?? "", mediaType: "image/png" });
  }

  // Remember the anonymous visitor's name across visits (not used when logged in).
  useEffect(() => {
    try { const w = localStorage.getItem("ping:who"); if (w) setFrom(w); } catch {}
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchWallFn();
      setSnapshot(next);
      setCooldown(next.cooldownRemaining); // server is the source of truth
      setOnline(true);
    } catch { setOnline(false); }
  }, []);

  // Poll.
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

  const used = message.length;
  const remaining = MAX - used;
  const onCooldown = !user && cooldown > 0; // logged-in accounts have no cooldown
  // A logged-in user may send a photo with no text; anon needs text.
  const hasContent = message.trim().length > 0 || (!!user && !!photo);
  const canSend = !sending && !onCooldown && hasContent && remaining >= 0;

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
          image: user && photo ? { data: photo.data, mediaType: photo.mediaType } : null,
        },
      });
      if (result.ok) {
        try { if (from.trim()) localStorage.setItem("ping:who", from.trim()); } catch {}
        setMessage("");
        setPhoto(null);
        if (fileRef.current) fileRef.current.value = "";
        setCooldown(result.cooldownRemaining);
        setJustPinged(true);
        setTimeout(() => setJustPinged(false), 700);
        await refresh();
      } else {
        setError(result.error);
        if (result.cooldownRemaining) setCooldown(result.cooldownRemaining);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* soft radial glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{ background: "radial-gradient(60% 100% at 50% 0%, color-mix(in oklch, var(--foreground) 6%, transparent), transparent 70%)" }}
      />

      <div className="relative mx-auto w-full max-w-lg px-5 py-12 sm:py-20 space-y-12">

        {/* Header */}
        <header className="space-y-7">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2.5">
              <PulseMark size={14} shoot={justPinged} />
              <span className="font-display text-lg font-semibold tracking-tight lowercase">ping</span>
            </div>
            <div className="flex items-center gap-1">
              {user ? (
                <button onClick={async () => { await logoutFn(); refresh(); }}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-full hover:bg-accent transition-colors">
                  {user} <LogOut size={13} />
                </button>
              ) : (
                <button onClick={() => setShowLogin(v => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-full hover:bg-accent transition-colors">
                  Iniciar sesión
                </button>
              )}
              <ThemeToggle />
            </div>
          </div>

          <div className="space-y-4">
            <h1 className="font-display text-[2.5rem] sm:text-5xl leading-[1.03] tracking-tight">
              Mándame un ping.
            </h1>
            <p className="text-[15px] leading-relaxed text-muted-foreground max-w-md">
              Escríbelo y, al darle a imprimir, sale en papel en la impresora térmica
              que tengo en el escritorio. Un mensaje de internet que termina en algo
              que puedo tocar. <span className="text-foreground">Lo voy a leer.</span>
            </p>
            <StatusPill online={online} />
          </div>
        </header>

        {/* Login (anonymous only) */}
        {!user && showLogin && (
          <LoginPanel onDone={() => { setShowLogin(false); refresh(); }} />
        )}

        {/* Composer — a paper slip you fill in */}
        <form onSubmit={handleSubmit}
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="space-y-4 p-5">
            {user ? (
              <p className="text-xs text-muted-foreground">
                Mandando como <span className="font-medium text-foreground">{user}</span>.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="from" className="text-xs text-muted-foreground">Tu nombre</Label>
                <Input id="from" value={from} onChange={e => setFrom(e.target.value)}
                  placeholder="anónimo" maxLength={24} disabled={sending || onCooldown}
                  className="bg-input-bg" />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="message" className="text-xs text-muted-foreground">Mensaje</Label>
                <CharRing used={used} />
              </div>
              <Textarea id="message" value={message} onChange={e => setMessage(e.target.value)}
                placeholder="Di algo — se imprime en papel de verdad." rows={4}
                disabled={sending || onCooldown}
                className="bg-input-bg resize-none leading-relaxed" />
            </div>

            {/* Photo attachment — logged-in only */}
            {user && (
              <div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) pickPhoto(f).catch(() => setError("No se pudo cargar la imagen")); }} />
                {photo ? (
                  <div className="relative inline-block">
                    <img src={photo.preview} alt="adjunto"
                      className="max-h-44 rounded-lg border border-border"
                      style={{ imageRendering: "pixelated" }} />
                    <button type="button" onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ""; }}
                      className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center rounded-full bg-foreground text-background shadow transition-transform active:scale-90">
                      <XIcon size={13} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={sending}
                    className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground rounded-full border border-border px-3 py-1.5 hover:bg-accent transition-colors">
                    <ImagePlus size={14} /> Adjuntar foto
                  </button>
                )}
              </div>
            )}

            {/* Honeypot — off-screen, not focusable. Bots fill it. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Website
                <input type="text" tabIndex={-1} autoComplete="off" value={website}
                  onChange={e => setWebsite(e.target.value)} />
              </label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {/* footer strip */}
          <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-5 py-3.5">
            <p className="text-xs text-muted-foreground/90 leading-snug">
              {user
                ? "Sin límite — manda los que quieras."
                : onCooldown
                ? <>Vuelve en <span className="font-mono text-foreground [font-variant-numeric:tabular-nums]">{formatCooldown(cooldown)}</span></>
                : "Un ping por visitante cada 30 min."}
            </p>
            <Button type="submit" disabled={!canSend} size="lg"
              className="gap-2 rounded-full px-5 shrink-0 transition-[transform,opacity] active:scale-[0.95]">
              {sending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              {sending ? "Enviando…" : "Imprimir"}
            </Button>
          </div>
        </form>

        {/* Your own pings */}
        {snapshot.items.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-sm tracking-wide text-muted-foreground">
                {user ? "Tu historial" : "Tus pings"}
              </h2>
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-muted-foreground/60 [font-variant-numeric:tabular-nums]">
                {snapshot.items.length}
              </span>
            </div>

            <div className="space-y-3">
              {snapshot.items.map((item, i) => (
                <PingSlip key={item.id} message={item.message} from={item.from}
                  createdAt={item.createdAt} delay={Math.min(i * 60, 300)} hasImage={item.hasImage} />
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground/60 text-center pt-1">
              {user
                ? "El historial de tu cuenta, donde sea que inicies sesión."
                : "Solo tú ves tus pings. Se imprimen en mi escritorio."}
            </p>
          </section>
        )}

        <footer className="flex items-center justify-center gap-2 pt-4 text-xs text-muted-foreground/70">
          <Printer size={12} />
          <a href="https://allison.sh" className="hover:text-foreground transition-colors">allison.sh</a>
        </footer>

      </div>
    </div>
  );
}

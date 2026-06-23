import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Sun, Moon, LogOut, ChevronRight, ImagePlus, Camera, SwitchCamera, X as XIcon, Trash2 } from "lucide-react";
import { fetchWallFn, submitMessageFn, fetchPhotoFn, hidePingFn, type WallSnapshot } from "~/api";
import { loginFn, logoutFn } from "~/session";
import { getRecaptchaToken } from "~/lib/recaptcha";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { playSound } from "~/lib/sound-engine";
import { select006Sound } from "~/lib/select-006";

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

// Plays the "ping" sound (soundcn select-006) on send. Fired from the click, so
// the audio context is allowed to start. Fire-and-forget; ignore audio errors.
function playPing(): void {
  void playSound(select006Sound.dataUri, { volume: 0.5 }).catch(() => { /* no audio */ });
}

// Brand mark: a dot emitting signal rings — the one bit of ambient motion.
function PulseMark({ shoot = false }: { shoot?: boolean }) {
  return (
    <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
      <span className="ping-rings absolute inset-0"><span /><span /><span /></span>
      {shoot && <span className="ping-shoot absolute inset-0 rounded-full border-[1.5px]" style={{ borderColor: "var(--signal)" }} />}
      <span className="ping-dot relative h-1.5 w-1.5 rounded-full" style={{ background: "var(--signal)" }} />
    </span>
  );
}

// Borderless circular counter — just the progress arc, no track ring.
function CountArc({ used }: { used: number }) {
  const R = 9, C = 2 * Math.PI * R;
  const pct = Math.min(used / MAX, 1);
  const over = used > MAX;
  const left = MAX - used;
  const color = over ? "var(--destructive)" : pct > 0.9 ? "var(--color-amber)" : "var(--signal)";
  return (
    <span className="relative inline-flex h-6 w-6 items-center justify-center">
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90">
        <circle cx="12" cy="12" r={R} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.2s ease, stroke 0.2s ease" }} />
      </svg>
      <span className="absolute text-[9px] font-medium [font-variant-numeric:tabular-nums]"
        style={{ color: over ? "var(--destructive)" : "var(--muted-foreground)" }}>
        {left}
      </span>
    </span>
  );
}

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
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-[color,background-color,transform] active:scale-[0.94]">
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

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

function PingSlip({ id, message, from, createdAt, delay, hasImage, onHide }: {
  id: string; message: string; from: string; createdAt: number; delay: number; hasImage: boolean;
  onHide: () => void;
}) {
  const clock = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [photo, setPhoto] = useState<string | null>(null);

  // Lazily pull the photo for this ping (owner-scoped on the server).
  useEffect(() => {
    if (!hasImage) return;
    let on = true;
    fetchPhotoFn({ data: { id } })
      .then(r => { if (on && r) setPhoto(r.src); })
      .catch(() => { /* leave the placeholder */ });
    return () => { on = false; };
  }, [id, hasImage]);

  return (
    <article
      className="ping-rise rounded-xl border border-border bg-card py-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* receipt header */}
      <div className="flex items-center justify-between px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>ping</span>
        <div className="flex items-center gap-2">
          <span className="[font-variant-numeric:tabular-nums]">{clock}</span>
          <button type="button" onClick={onHide} aria-label="Quitar de mi historial"
            className="relative -mr-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/45 transition-[color,background-color,scale] hover:bg-destructive/10 hover:text-destructive active:scale-[0.96] before:absolute before:-inset-1.5 before:content-['']">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <hr className="perf mx-4 my-2.5" />

      {message && <p className="px-4 text-[15px] leading-relaxed whitespace-pre-wrap break-words">{message}</p>}
      {hasImage && (
        <div className={`px-4 ${message ? "mt-2.5" : ""}`}>
          {photo ? (
            <img src={photo} alt="foto enviada"
              className="w-full rounded-lg border border-border" />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground/60">
              <ImagePlus size={18} className="animate-pulse" />
            </div>
          )}
        </div>
      )}

      <hr className="perf mx-4 my-2.5" />

      <div className="flex items-center justify-between px-4 font-mono text-[11px] text-muted-foreground/80">
        <span className="truncate">— {from}</span>
        <span className="shrink-0 [font-variant-numeric:tabular-nums]">{timeAgo(createdAt)}</span>
      </div>
    </article>
  );
}

// Full-screen live camera. Requests permission via getUserMedia, shows the feed,
// and hands a captured frame (data URL) back to the parent. Front camera preview
// is mirrored; the saved frame is not.
function CameraCapture({ onCapture, onClose }: {
  onCapture: (dataUrl: string) => void; onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        if (!cancelled) setError("No pude usar la cámara. Revisa los permisos del navegador.");
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  // Capture the largest centred 1:2 (width:height) crop from the frame — matches
  // the framed preview, and suits the tall receipt format.
  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    let cw: number, ch: number;
    if (vh >= vw * 2) { cw = vw; ch = vw * 2; }  // tall source → limited by width
    else { ch = vh; cw = vh / 2; }               // wide source → limited by height
    const sx = (vw - cw) / 2, sy = (vh - ch) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw);
    canvas.height = Math.round(ch);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.92));
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-white">
          <Camera size={28} className="opacity-70" />
          <p className="max-w-xs text-sm opacity-90">{error}</p>
          <button onClick={onClose} className="rounded-full bg-white/15 px-5 py-2.5 text-sm font-medium active:scale-[0.96]">
            Cerrar
          </button>
        </div>
      ) : (
        <>
          {/* Top controls */}
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <button onClick={onClose} aria-label="Cerrar"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-[scale] active:scale-[0.94]">
              <XIcon size={18} />
            </button>
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/55">papel · 1:2</span>
            <button onClick={() => setFacing(f => (f === "environment" ? "user" : "environment"))}
              aria-label="Cambiar cámara"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-[scale] active:scale-[0.94]">
              <SwitchCamera size={18} />
            </button>
          </div>

          {/* Framed 1:2 preview — exactly what gets captured */}
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="relative aspect-[1/2] h-[68vh] max-h-[600px] overflow-hidden rounded-[28px] bg-neutral-900 shadow-2xl ring-1 ring-white/15">
              {!ready && (
                <div className="absolute inset-0 z-10 flex items-center justify-center text-white/50">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              )}
              <video ref={videoRef} playsInline muted
                className="h-full w-full object-cover"
                style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }} />
              {/* corner framing marks */}
              <span className="pointer-events-none absolute left-3 top-3 h-6 w-6 rounded-tl-md border-l-2 border-t-2 border-white/60" />
              <span className="pointer-events-none absolute right-3 top-3 h-6 w-6 rounded-tr-md border-r-2 border-t-2 border-white/60" />
              <span className="pointer-events-none absolute bottom-3 left-3 h-6 w-6 rounded-bl-md border-b-2 border-l-2 border-white/60" />
              <span className="pointer-events-none absolute bottom-3 right-3 h-6 w-6 rounded-br-md border-b-2 border-r-2 border-white/60" />
            </div>
          </div>

          {/* Shutter */}
          <div className="flex items-center justify-center pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
            <button onClick={shoot} disabled={!ready} aria-label="Tomar foto"
              className="group flex h-[72px] w-[72px] items-center justify-center rounded-full ring-[3px] ring-white/80 transition-[scale] active:scale-[0.92] disabled:opacity-40">
              <span className="h-14 w-14 rounded-full bg-white transition-transform group-active:scale-90" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

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
  const [justPinged, setJustPinged] = useState(false);
  const [processing, setProcessing] = useState(false); // downscaling a picked photo
  // Attached photo (logged-in only): preview = data URL for <img>, data = base64 payload.
  // preview/data = 384px print bitmap; original = the full-res file, archived only.
  const [photo, setPhoto] = useState<{
    preview: string; data: string; mediaType: string;
    original: string; originalMediaType: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const user = snapshot.user;
  const mountedAt = useRef(Date.now());

  // Downscale a source image (data URL) to 384px wide (printer width) for the
  // print bitmap, and keep the original base64 so the API can archive full-res.
  async function buildPhotoFromDataUrl(dataUrl: string, originalMediaType: string) {
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
    setPhoto({
      preview: png, data: png.split(",")[1] ?? "", mediaType: "image/png",
      original: dataUrl.split(",")[1] ?? "", originalMediaType,
    });
  }

  // Read a picked file into a data URL, then process it (with a busy state).
  async function handlePickFile(file: File) {
    setProcessing(true);
    setError("");
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await buildPhotoFromDataUrl(dataUrl, file.type || "image/png");
    } catch { setError("No se pudo cargar la imagen"); }
    finally { setProcessing(false); }
  }

  // A frame captured from the live camera (already a data URL).
  async function handleCapture(dataUrl: string) {
    setCameraOpen(false);
    setProcessing(true);
    setError("");
    try { await buildPhotoFromDataUrl(dataUrl, "image/jpeg"); }
    catch { setError("No se pudo procesar la foto"); }
    finally { setProcessing(false); }
  }

  useEffect(() => {
    try { const w = localStorage.getItem("ping:who"); if (w) setFrom(w); } catch {}
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchWallFn();
      setSnapshot(next);
      setCooldown(next.cooldownRemaining); // server is the source of truth
    } catch { /* keep last snapshot */ }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1000)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const remaining = MAX - message.length;
  const nearLimit = remaining <= 40;
  const onCooldown = !user && cooldown > 0;
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
          message, from, website,
          recaptchaToken: token,
          elapsedMs: Date.now() - mountedAt.current,
          image: user && photo
            ? { data: photo.data, mediaType: photo.mediaType, original: photo.original, originalMediaType: photo.originalMediaType }
            : null,
        },
      });
      if (result.ok) {
        try { if (from.trim()) localStorage.setItem("ping:who", from.trim()); } catch {}
        setMessage("");
        setPhoto(null);
        if (fileRef.current) fileRef.current.value = "";
        setCooldown(result.cooldownRemaining);
        setJustPinged(true);
        playPing();
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

  // Hide a ping from this history view. Optimistic — the server keeps it queued
  // and the printer API keeps the job; this only drops it from the owner's list.
  async function handleHide(id: string) {
    setSnapshot(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) }));
    try { await hidePingFn({ data: { id } }); } catch { /* reappears on next poll if it failed */ }
  }

  const hint = user ? "" : onCooldown ? formatCooldown(cooldown) : "1 ping · 30 min";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col px-5 py-14 sm:py-20">

      {/* Header */}
      <header className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2">
          <PulseMark shoot={justPinged} />
          <span className="font-display text-lg font-semibold tracking-tight">
            Ping<span className="text-muted-foreground">.allison.sh</span>
          </span>
        </span>
        <div className="flex items-center gap-1">
          {user ? (
            <button onClick={async () => { await logoutFn(); refresh(); }}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              {user} <LogOut size={13} />
            </button>
          ) : (
            <button onClick={() => setShowLogin(v => !v)}
              className="rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              Entrar
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* Hero — one line */}
      <div className="mt-12 space-y-2.5">
        <h1 className="font-display text-4xl sm:text-5xl tracking-tight">
          Mándame un <span style={{ color: "var(--signal)" }}>Ping</span>.
        </h1>
        <p className="text-[15px] leading-relaxed text-foreground/80 text-pretty">
          Lo que mandes sale impreso como una boleta en mi escritorio.{" "}
          <span className="cursor-default font-mono font-bold italic text-foreground transition-colors hover:text-[var(--signal)]">
            zzzt
          </span>.
        </p>
      </div>

      {!user && showLogin && <div className="mt-5"><LoginPanel onDone={() => { setShowLogin(false); refresh(); }} /></div>}

      {/* Composer — the card is the input */}
      <form onSubmit={handleSubmit}
        className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring/60">
        {user ? (
          <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
            como <span className="font-medium text-foreground">{user}</span>
          </p>
        ) : (
          <input value={from} onChange={e => setFrom(e.target.value)}
            placeholder="tu nombre (opcional)" maxLength={24} disabled={sending || onCooldown}
            className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/50" />
        )}

        <Textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Escribe algo…" rows={4} disabled={sending || onCooldown}
          className="min-h-28 resize-none border-0 bg-transparent px-4 py-3.5 text-[15px] leading-relaxed shadow-none focus-visible:ring-0" />

        {/* Photo preview (logged-in, when attached) */}
        {user && photo && (
          <div className="ping-rise px-4 pb-3">
            <div className="relative inline-block">
              <img src={photo.preview} alt="Foto adjunta"
                className="max-h-44 rounded-xl outline outline-1 -outline-offset-1 outline-foreground/10" />
              <button type="button" aria-label="Quitar foto"
                onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition-[scale] active:scale-[0.96] shadow-[0_1px_2px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.16)] before:absolute before:-inset-2 before:content-['']">
                <XIcon size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Honeypot */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
        </div>

        {/* Action strip */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {user && !photo && (
              <>
                {/* Gallery / file picker */}
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handlePickFile(f); e.target.value = ""; }} />
                {processing ? (
                  <span className="inline-flex h-9 items-center gap-1.5 px-1 text-xs text-muted-foreground">
                    <Loader2 size={15} className="animate-spin" /> Cargando…
                  </span>
                ) : (
                  <>
                    {/* Live camera — asks for permission and uses the device camera */}
                    <button type="button" onClick={() => setCameraOpen(true)} disabled={sending}
                      aria-label="Tomar una foto con la cámara"
                      className="group inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-[color,background-color,border-color,scale] hover:border-ring/40 hover:text-foreground active:scale-[0.96] disabled:opacity-50">
                      <Camera size={15} className="transition-transform group-hover:-translate-y-px" />
                      Cámara
                    </button>
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={sending}
                      aria-label="Adjuntar una foto"
                      className="group inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-[color,background-color,border-color,scale] hover:border-ring/40 hover:text-foreground active:scale-[0.96] disabled:opacity-50">
                      <ImagePlus size={15} className="transition-transform group-hover:-translate-y-px" />
                    </button>
                  </>
                )}
              </>
            )}
            {hint && <span className="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">{hint}</span>}
          </div>
          <div className="flex items-center gap-3">
            {nearLimit && <CountArc used={message.length} />}
            <Button type="submit" disabled={!canSend} size="lg"
              className="shrink-0 cursor-pointer gap-1.5 rounded-full pl-5 pr-4 transition-[transform,filter,background-color] active:scale-[0.92] active:brightness-90">
              {sending ? "enviando…" : "Ping"}
              {sending ? <Loader2 size={15} className="animate-spin" /> : <ChevronRight size={15} className="-mr-0.5" />}
            </Button>
          </div>
        </div>
      </form>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {/* Your own pings */}
      {snapshot.items.length > 0 && (
        <section className="mt-12 space-y-3">
          <h2 className="font-display text-sm tracking-wide text-muted-foreground">
            {user ? "Tu historial" : "Tus pings"}
          </h2>
          {snapshot.items.map((item, i) => (
            <PingSlip key={item.id} id={item.id} message={item.message} from={item.from}
              createdAt={item.createdAt} delay={Math.min(i * 50, 250)} hasImage={item.hasImage}
              onHide={() => handleHide(item.id)} />
          ))}
        </section>
      )}

      <footer className="mt-auto pt-12 text-center">
        <a href="https://allison.sh" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors">allison.sh</a>
      </footer>

      {/* Live camera (logged-in only — the only trigger lives in the composer). */}
      {user && cameraOpen && (
        <CameraCapture onCapture={handleCapture} onClose={() => setCameraOpen(false)} />
      )}

    </div>
  );
}

// Tiny dictionary-based i18n for the wall. Two locales, served at /es and /en.
// Server strings (login/submit API errors) are passed through untranslated.

export type Lang = "es" | "en";

export const LANGS: Lang[] = ["es", "en"];

export function isLang(v: string): v is Lang {
  return v === "es" || v === "en";
}

// Pick a locale from an Accept-Language header. Defaults to Spanish — this is a
// Spanish-first personal page; English is the alternate.
export function pickLang(acceptLanguage: string | null | undefined): Lang {
  if (!acceptLanguage) return "es";
  for (const part of acceptLanguage.split(",")) {
    const tag = part.trim().slice(0, 2).toLowerCase();
    if (tag === "en") return "en";
    if (tag === "es") return "es";
  }
  return "es";
}

export const dict = {
  es: {
    htmlLang: "es",
    title: "ping · mándame algo a la impresora",
    description:
      "Mándame un ping: escribe un mensaje y sale impreso en papel, en la impresora térmica que tengo en mi escritorio.",
    heroPre: "Mándame un",
    ping: "Ping",
    bodyPre: "Lo que mandes sale impreso como una boleta en mi escritorio. ",
    themeToggle: "Cambiar tema",
    signIn: "Entrar",
    cancel: "Cancelar",
    username: "usuario",
    password: "contraseña",
    signInError: "No se pudo iniciar sesión",
    namePlaceholder: "tu nombre (opcional)",
    asUser: "como",
    messagePlaceholder: "Escribe algo…",
    photoAttachedAlt: "Foto adjunta",
    removePhoto: "Quitar foto",
    cameraAria: "Tomar una foto con la cámara",
    camera: "Cámara",
    attachPhoto: "Adjuntar una foto",
    loadingImage: "Cargando…",
    quotaHint: (min: number) => `1 ping · ${min} min`,
    nextPingIn: (time: string) => `Otro ping en ${time}`,
    pausedTitle: "Pings en pausa",
    pausedBody: "Por ahora no estoy recibiendo pings anónimos. Prueba de nuevo más tarde, o inicia sesión si tienes cuenta.",
    sending: "enviando…",
    send: "Ping",
    sentConfirm: "Enviado · sale impreso en el escritorio",
    imgLoadError: "No se pudo cargar la imagen",
    imgProcessError: "No se pudo procesar la foto",
    genericError: "Algo salió mal",
    historyUser: "Tu historial",
    historyAnon: "Tus pings",
    slipRemove: "Quitar de mi historial",
    slipPhotoAlt: "foto enviada",
    camError: "No pude usar la cámara. Revisa los permisos del navegador.",
    close: "Cerrar",
    switchCamera: "Cambiar cámara",
    takePhoto: "Tomar foto",
    paperFormat: "papel · 1:2",
    now: "ahora",
    minAgo: (n: number) => `hace ${n} min`,
    hourAgo: (n: number) => `hace ${n} h`,
    dayAgo: (n: number) => `hace ${n} d`,
  },
  en: {
    htmlLang: "en",
    title: "ping · send something to my printer",
    description:
      "Send me a ping: type a message and it prints out on paper, on the thermal printer sitting on my desk.",
    heroPre: "Send me a",
    ping: "Ping",
    bodyPre: "Whatever you send prints out as a receipt on my desk. ",
    themeToggle: "Toggle theme",
    signIn: "Sign in",
    cancel: "Cancel",
    username: "username",
    password: "password",
    signInError: "Couldn't sign in",
    namePlaceholder: "your name (optional)",
    asUser: "as",
    messagePlaceholder: "Write something…",
    photoAttachedAlt: "Attached photo",
    removePhoto: "Remove photo",
    cameraAria: "Take a photo with the camera",
    camera: "Camera",
    attachPhoto: "Attach a photo",
    loadingImage: "Loading…",
    quotaHint: (min: number) => `1 ping · ${min} min`,
    nextPingIn: (time: string) => `Next ping in ${time}`,
    pausedTitle: "Pings paused",
    pausedBody: "I'm not taking anonymous pings right now. Try again later, or sign in if you have an account.",
    sending: "sending…",
    send: "Ping",
    sentConfirm: "Sent · printing on the desk",
    imgLoadError: "Couldn't load the image",
    imgProcessError: "Couldn't process the photo",
    genericError: "Something went wrong",
    historyUser: "Your history",
    historyAnon: "Your pings",
    slipRemove: "Remove from my history",
    slipPhotoAlt: "sent photo",
    camError: "Couldn't access the camera. Check your browser permissions.",
    close: "Close",
    switchCamera: "Switch camera",
    takePhoto: "Take photo",
    paperFormat: "paper · 1:2",
    now: "now",
    minAgo: (n: number) => `${n} min ago`,
    hourAgo: (n: number) => `${n}h ago`,
    dayAgo: (n: number) => `${n}d ago`,
  },
} satisfies Record<Lang, Record<string, unknown>>;

export type Dict = (typeof dict)[Lang];

export function timeAgo(ts: number, t: Dict): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return t.now;
  if (s < 3600) return t.minAgo(Math.floor(s / 60));
  if (s < 86400) return t.hourAgo(Math.floor(s / 3600));
  return t.dayAgo(Math.floor(s / 86400));
}

// Locale-neutral m:ss countdown.
export function formatCooldown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

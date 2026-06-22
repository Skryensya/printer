// Tiny reCAPTCHA v3 client helper. Loads the script once and returns a token
// for a given action. If no site key is configured, it resolves to "" so the
// server's dev bypass takes over.

const SITE_KEY = import.meta.env["VITE_WALL_RECAPTCHA_SITE_KEY"] ?? "";

export function recaptchaEnabled(): boolean {
  return SITE_KEY.trim().length > 0;
}

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

let loader: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return resolve();
    const src = `https://www.google.com/recaptcha/api.js?render=${SITE_KEY}`;
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load reCAPTCHA"));
    document.head.appendChild(script);
  });
  return loader;
}

export async function getRecaptchaToken(action = "submit"): Promise<string> {
  if (!recaptchaEnabled()) return "";
  await loadScript();
  const grecaptcha = window.grecaptcha;
  if (!grecaptcha) return "";
  await new Promise<void>(resolve => grecaptcha.ready(resolve));
  return grecaptcha.execute(SITE_KEY, { action });
}

// Server-only reCAPTCHA v3 verification. If no secret is configured (dev), it
// passes through so the wall is still usable locally without Google keys.

import { config, recaptchaConfigured } from "./config";

interface SiteVerifyResponse {
  success:      boolean;
  score?:       number;
  action?:      string;
  "error-codes"?: string[];
}

const MIN_SCORE = 0.5;

export async function verifyRecaptcha(token: string, ip: string): Promise<{ ok: boolean; reason?: string }> {
  if (!recaptchaConfigured()) return { ok: true }; // dev bypass

  if (!token) return { ok: false, reason: "Missing captcha token" };

  try {
    const body = new URLSearchParams({
      secret:   config.recaptchaSecret,
      response: token,
      remoteip: ip,
    });
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as SiteVerifyResponse;
    if (!data.success) return { ok: false, reason: "Captcha failed" };
    if (typeof data.score === "number" && data.score < MIN_SCORE) {
      return { ok: false, reason: "Captcha score too low" };
    }
    return { ok: true };
  } catch {
    // Fail closed: if Google is unreachable, don't let traffic through.
    return { ok: false, reason: "Captcha verification unavailable" };
  }
}

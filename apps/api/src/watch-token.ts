import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies a short-lived watch-WebSocket token of the form "<expiryMs>.<hmac>".
// The web server issues it signed with ADMIN_API_KEY; this lets the browser open
// the watch socket without ever carrying the admin key. Mirrors watchTokenFn in
// apps/web/app/server/printer.ts.
export function verifyWatchToken(token: string, secret: string): boolean {
  if (!secret) return false;
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = createHmac("sha256", secret).update(expStr).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

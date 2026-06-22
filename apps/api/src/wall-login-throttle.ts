// In-memory brute-force guard for wall login, keyed by username. The wall calls
// the login endpoint server-side, so the API can't see the visitor's IP — the
// username is the stable thing to protect. A single long-lived API process owns
// this, so a module-level Map is correct.

const MAX_FAILS = 5;          // failed attempts before a lock kicks in
const LOCK_MS   = 15 * 60_000; // lock window once tripped

interface Attempt { fails: number; lockedUntil: number }

const attempts = new Map<string, Attempt>();

// Returns seconds to wait if currently locked, else 0.
export function loginLockRemaining(username: string, now = Date.now()): number {
  const a = attempts.get(username);
  if (!a || a.lockedUntil <= now) return 0;
  return Math.ceil((a.lockedUntil - now) / 1000);
}

export function recordLoginFailure(username: string, now = Date.now()): void {
  const a = attempts.get(username) ?? { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.lockedUntil = now + LOCK_MS;
    a.fails = 0; // reset the counter; the lock is the penalty now
  }
  attempts.set(username, a);
}

export function recordLoginSuccess(username: string): void {
  attempts.delete(username);
}

// Tests only.
export function resetLoginThrottle(): void {
  attempts.clear();
}

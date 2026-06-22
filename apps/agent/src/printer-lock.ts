import { dlopen, FFIType } from "bun:ffi";
import { openSync, closeSync, chmodSync } from "node:fs";
import { join } from "node:path";

// Cross-process lock so multiple agents sharing one USB printer take turns
// instead of racing on the exclusive interface claim.
//
// Backed by flock(2): the kernel owns the lock, tied to an open fd, and releases
// it AUTOMATICALLY when the holder's fd closes — including on crash/SIGKILL. That
// removes the whole class of bugs a presence-based lockfile has: no stale-timeout
// heuristic (a long print is never falsely stolen), no TOCTOU reclaiming a dead
// lock, no orphaned lock after a kill.
//
// Priority: flock alone is first-come. To make the persistent/prod agent always
// win over a dev agent, we add a second "intent" lock. A high-priority agent
// holds INTENT while it wants/uses the printer; a low-priority agent only prints
// when no one holds INTENT, and otherwise stands down until the high agent is
// fully done. Note: an in-progress print is never preempted (that would tear a
// receipt in half) — priority decides who goes next, not who can interrupt.

const LOCK_PATH          = process.env["PRINTER_LOCK_PATH"]          ?? join(import.meta.dir, "..", ".printer.lock");
const INTENT_PATH        = LOCK_PATH + ".intent";
const ACQUIRE_TIMEOUT_MS = Number(process.env["PRINTER_LOCK_TIMEOUT_MS"] ?? 60_000);
const POLL_MS            = 100;
// "high" (default) goes ahead of "low" agents. The persistent/prod agent stays
// high; run the dev agent with PRINTER_PRIORITY=low so it yields to prod.
const IS_LOW_PRIORITY    = (process.env["PRINTER_PRIORITY"] ?? "high").toLowerCase() === "low";

// flock(2) operation flags — identical on macOS (BSD) and Linux.
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

const LIBC_PATH = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";

const { symbols: { flock } } = dlopen(LIBC_PATH, {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});

function openLockFd(path: string): number {
  const fd = openSync(path, "a", 0o666);
  // umask usually strips create mode to 0644; force 0666 so the other uid can
  // open it. Only the owner can chmod — whoever creates it first sets it; the
  // other's chmod is a harmless no-op.
  try { chmodSync(path, 0o666); } catch { /* not owner — already set by creator */ }
  return fd;
}

// Poll a non-blocking flock until acquired or the deadline passes.
async function grab(fd: number, deadline: number): Promise<boolean> {
  for (;;) {
    if (flock(fd, LOCK_EX | LOCK_NB) === 0) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(POLL_MS);
  }
}

function unlock(fd: number): void {
  try { flock(fd, LOCK_UN); } catch { /* released on close anyway */ }
  closeSync(fd);
}

function busy(detail: string): Error {
  return new Error(`PRINTER_BUSY: ${detail}`);
}

export async function withPrinterLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  const release = IS_LOW_PRIORITY ? await acquireLow(deadline) : await acquireHigh(deadline);
  try {
    return await fn();
  } finally {
    release();
  }
}

// High priority: hold the intent lane, then take the printer. Holding intent for
// the whole job makes low-priority agents stand down until we're completely done.
async function acquireHigh(deadline: number): Promise<() => void> {
  const intentFd = openLockFd(INTENT_PATH);
  if (!(await grab(intentFd, deadline))) {
    unlock(intentFd);
    throw busy("timed out waiting for the intent lock");
  }
  const printFd = openLockFd(LOCK_PATH);
  if (!(await grab(printFd, deadline))) {
    unlock(printFd);
    unlock(intentFd);
    throw busy("timed out waiting for the printer lock");
  }
  return () => { unlock(printFd); unlock(intentFd); };
}

// Low priority: only print when no high-priority agent wants the printer. If one
// does, drop the printer and wait until it's fully finished, then retry.
async function acquireLow(deadline: number): Promise<() => void> {
  for (;;) {
    const printFd = openLockFd(LOCK_PATH);
    if (!(await grab(printFd, deadline))) {
      unlock(printFd);
      throw busy("timed out waiting for the printer lock");
    }
    // We hold the printer — but is a high-priority agent waiting?
    const intentFd = openLockFd(INTENT_PATH);
    if (flock(intentFd, LOCK_EX | LOCK_NB) === 0) {
      // No one in the intent lane — release the probe and go.
      unlock(intentFd);
      return () => { unlock(printFd); };
    }
    // High priority wants in: yield the printer, then wait for it to fully finish.
    closeSync(intentFd);
    unlock(printFd);
    if (Date.now() >= deadline) throw busy("yielded to higher-priority agent, timed out");
    const waitFd = openLockFd(INTENT_PATH);
    await grab(waitFd, deadline); // blocks until the high agent releases intent
    unlock(waitFd);
    // loop and retry the printer
  }
}

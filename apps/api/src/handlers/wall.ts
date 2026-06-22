import { createWallUser, listWallUsers, deleteWallUser, verifyWallUser } from "../db";
import { loginLockRemaining, recordLoginFailure, recordLoginSuccess } from "../wall-login-throttle";

function err(msg: string, status = 400): Response {
  return Response.json({ error: msg }, { status });
}

// ─── Admin: manage wall accounts (called from the print-admin backoffice) ──────

export async function listWallUsersHandler(_req: Request): Promise<Response> {
  return Response.json({ users: await listWallUsers() });
}

export async function createWallUserHandler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as {
    username?: string; password?: string; display_name?: string;
  } | null;
  const username = body?.username?.trim().toLowerCase();
  const password = body?.password ?? "";
  const display  = body?.display_name?.trim() || username;
  if (!username) return err("username is required");
  if (password.length < 6) return err("password must be at least 6 characters");

  const user = await createWallUser(username, password, display!);
  if (!user) return err("Username already exists", 409);
  return Response.json({ user }, { status: 201 });
}

export async function deleteWallUserHandler(_req: Request, username: string): Promise<Response> {
  const ok = await deleteWallUser(username);
  if (!ok) return err("User not found", 404);
  return new Response(null, { status: 204 });
}

// ─── Login verification (called server-side by the wall) ───────────────────────
// Returns the account's display name on success. The wall holds the session.

export async function wallLoginHandler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as { username?: string; password?: string } | null;
  const username = body?.username?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  if (!username || !password) return err("Invalid credentials", 401);

  // Brute-force guard: lock a username after too many failures.
  const lock = loginLockRemaining(username);
  if (lock > 0) {
    return new Response(
      JSON.stringify({ error: "Too many attempts, try again later", retry_after: lock }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(lock) } },
    );
  }

  const user = await verifyWallUser(username, password);
  if (!user) {
    recordLoginFailure(username);
    return err("Invalid credentials", 401);
  }
  recordLoginSuccess(username);
  return Response.json({ username: user.username, display_name: user.display_name });
}

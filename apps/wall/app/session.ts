// Wall sessions. A logged-in visitor (account created by the admin) has no
// message cooldown and a fixed display name. There is no signup — accounts are
// created from the print-admin backoffice. Login is verified against the API.
import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

interface WallSession { username: string; name: string }

function getSession() {
  return useSession<WallSession>({
    password: process.env["SESSION_SECRET"] ?? "wall-dev-secret-key-min-32-chars!!!!",
  });
}

// Server-only: returns the current visitor's account, or null.
export async function currentUser(): Promise<{ username: string; name: string } | null> {
  const s = await getSession();
  return s.data.username ? { username: s.data.username, name: s.data.name ?? s.data.username } : null;
}

export const loginFn = createServerFn({ method: "POST" })
  .validator((d: { username: string; password: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; name?: string; error?: string }> => {
    const { config } = await import("./server/config");
    const res = await fetch(`${config.apiUrl}/api/v1/wall/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
      body:    JSON.stringify({ username: data.username, password: data.password }),
    });
    if (!res.ok) return { ok: false, error: "Usuario o contraseña incorrectos" };
    const u = await res.json() as { username: string; display_name: string };
    const s = await getSession();
    await s.update({ username: u.username, name: u.display_name });
    return { ok: true, name: u.display_name };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await getSession();
  await s.clear();
});

export const sessionFn = createServerFn({ method: "GET" }).handler(async (): Promise<{ name: string | null }> => {
  const s = await getSession();
  return { name: s.data.username ? (s.data.name ?? s.data.username) : null };
});

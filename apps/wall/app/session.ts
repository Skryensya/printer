// Wall login server functions (client-importable). There is no signup — accounts
// are created from the print-admin backoffice. Session reading lives in
// server/auth.ts so this module stays a pure server-fn module.
import { createServerFn } from "@tanstack/react-start";

export const loginFn = createServerFn({ method: "POST" })
  .validator((d: { username: string; password: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; name?: string; error?: string }> => {
    const { config } = await import("./server/config");
    const { getSession } = await import("./server/auth");
    const res = await fetch(`${config.apiUrl}/api/v1/wall/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
      body:    JSON.stringify({ username: data.username, password: data.password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? "Usuario o contraseña incorrectos" };
    }
    const u = await res.json() as { username: string; display_name: string };
    const s = await getSession();
    await s.update({ username: u.username, name: u.display_name });
    return { ok: true, name: u.display_name };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const { getSession } = await import("./server/auth");
  const s = await getSession();
  await s.clear();
});

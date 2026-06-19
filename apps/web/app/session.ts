import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type SessionData = { authenticated: boolean };

function getAppSession() {
  return useSession<SessionData>({
    password: process.env["SESSION_SECRET"] ?? "printer-dev-secret-key-min-32-chars!!",
  });
}

export const loginFn = createServerFn({ method: "POST" })
  .validator((data: { username: string; password: string }) => data)
  .handler(async ({ data }) => {
    const adminUser = process.env["ADMIN_USER"] ?? "";
    const adminPass = process.env["ADMIN_PASSWORD"] ?? "";

    if (!adminUser || !adminPass) {
      return { error: "ADMIN_USER / ADMIN_PASSWORD not set in apps/web/.env" };
    }
    if (data.username !== adminUser || data.password !== adminPass) {
      return { error: "Invalid username or password" };
    }

    const session = await getAppSession();
    await session.update({ authenticated: true });
    return { error: null };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const session = await getAppSession();
  await session.clear();
});

export const fetchSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAppSession();
  return { authenticated: session.data.authenticated === true };
});

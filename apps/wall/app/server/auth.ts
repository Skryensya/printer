// Server-only session helpers. Kept out of app/session.ts (which the client
// imports for the login/logout server functions) so no plain export drags
// @tanstack/react-start/server into the client bundle.
import { useSession } from "@tanstack/react-start/server";

interface WallSession { username: string; name: string }

export function getSession() {
  return useSession<WallSession>({
    password: process.env["SESSION_SECRET"] ?? "wall-dev-secret-key-min-32-chars!!!!",
  });
}

// The current visitor's account, or null.
export async function currentUser(): Promise<{ username: string; name: string } | null> {
  const s = await getSession();
  return s.data.username ? { username: s.data.username, name: s.data.name ?? s.data.username } : null;
}

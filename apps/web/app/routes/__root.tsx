import {
  createRootRoute,
  Outlet,
  HeadContent,
  Scripts,
  Link,
  redirect,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { getAgentStatus } from "~/api";
import { fetchSessionFn, logoutFn } from "~/session";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import "~/styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Printer" },
    ],
  }),
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/login") return;
    const { authenticated } = await fetchSessionFn();
    if (!authenticated) throw redirect({ to: "/login" });
  },
  component: RootComponent,
});

function StatusBadge() {
  const [connected, setConnected] = useState<boolean | null | "pending">("pending");

  useEffect(() => {
    getAgentStatus().then(setConnected);
    const id = setInterval(() => getAgentStatus().then(setConnected), 10_000);
    return () => clearInterval(id);
  }, []);

  if (connected === "pending") return <Badge variant="secondary">…</Badge>;
  if (connected === null)      return <Badge variant="destructive">api offline</Badge>;
  if (!connected)              return <Badge variant="outline">agent offline</Badge>;
  return                              <Badge variant="default">agent ready</Badge>;
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      activeProps={{ className: "text-sm text-foreground font-medium" }}
    >
      {children}
    </Link>
  );
}

function RootComponent() {
  async function handleLogout() {
    await logoutFn();
    window.location.href = "/login";
  }

  return (
    <RootDocument>
      <div className="h-screen flex flex-col overflow-hidden">
        <header className="flex-shrink-0 border-b border-border px-4 py-2 flex items-center justify-between bg-secondary">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-sm">🖨 printer</span>
              <span className="text-xs text-muted-foreground">POS-58</span>
            </div>
            <nav className="flex items-center gap-3">
              <NavLink to="/">Playground</NavLink>
              <NavLink to="/queue">Queue</NavLink>
              <NavLink to="/keys">Keys</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge />
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs">
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

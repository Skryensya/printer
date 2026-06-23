import {
  createRootRoute,
  Outlet,
  HeadContent,
  Scripts,
  Link,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Printer, Loader2, KeyRound, ListOrdered, LayoutGrid, BookOpen, Users } from "lucide-react";
import { getAgentStatus, type AgentStatus } from "~/api";
import { fetchSessionFn, logoutFn } from "~/session";
import "~/styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Printer" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/login" || location.pathname === "/docs") return;
    const { authenticated } = await fetchSessionFn();
    if (!authenticated) throw redirect({ to: "/login" });
  },
  component: RootComponent,
});

// ─── Live favicon — reflects agent status and animates ────────────────────────
// Browsers can't animate a favicon with CSS, so we redraw frames on a timer and
// swap the <link rel="icon"> href. Color = agent state; the expanding ring is the
// "active" pulse so the tab visibly signals connection at a glance.

const FAVICON_COLOR: Record<string, string> = {
  ready:           "#22c55e", // green — agent + printer up
  printer_offline: "#f59e0b", // amber — agent up, no printer
  offline:         "#9ca3af", // gray  — no agent connected
  loading:         "#9ca3af", // gray  — unknown / not authenticated (also null)
};

function setFaviconHref(href: string) {
  let link = document.querySelector<HTMLLinkElement>("link#live-favicon");
  if (!link) {
    link = document.createElement("link");
    link.id = "live-favicon";
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

function drawFavicon(color: string, phase: number, animate: boolean): string {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.clearRect(0, 0, 32, 32);
  // Expanding, fading ring — only when connected (ready/printer states).
  if (animate) {
    const r = 5 + phase * 10;
    ctx.beginPath();
    ctx.arc(16, 16, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 1 - phase;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Core dot.
  ctx.beginPath();
  ctx.arc(16, 16, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  return c.toDataURL("image/png");
}

function DynamicFavicon() {
  const [status, setStatus] = useState<AgentStatus | null | "loading">("loading");

  // Poll agent status independently of the badge.
  useEffect(() => {
    let on = true;
    const fetchOnce = () => getAgentStatus().then(s => { if (on) setStatus(s); }).catch(() => {});
    fetchOnce();
    const id = setInterval(fetchOnce, 8_000);
    return () => { on = false; clearInterval(id); };
  }, []);

  // Animate frames; redraw the favicon on each tick.
  useEffect(() => {
    const key = status === null ? "loading" : status; // null (offline/unauth) → neutral gray
    const color = FAVICON_COLOR[key] ?? FAVICON_COLOR["loading"]!;
    const animate = status === "ready" || status === "printer_offline";
    if (!animate) { setFaviconHref(drawFavicon(color, 0, false)); return; }
    let phase = 0;
    const id = setInterval(() => {
      phase = (phase + 0.08) % 1;
      setFaviconHref(drawFavicon(color, phase, true));
    }, 90);
    return () => clearInterval(id);
  }, [status]);

  return null;
}

function AgentStatusBadge() {
  const [status, setStatus] = useState<AgentStatus | null | "loading">("loading");

  useEffect(() => {
    getAgentStatus().then(setStatus);
    const id = setInterval(() => getAgentStatus().then(setStatus), 8_000);
    return () => clearInterval(id);
  }, []);

  if (status === "loading") return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1 rounded-full border border-border bg-muted/40">
      <Loader2 size={11} className="animate-spin" />
      Connecting
    </span>
  );
  if (status === null) return (
    <span className="flex items-center gap-1.5 text-xs text-destructive px-2.5 py-1 rounded-full border border-destructive/20 bg-destructive/8">
      <span className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
      API offline
    </span>
  );
  if (status === "offline") return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1 rounded-full border border-border bg-muted/40">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
      Agent offline
    </span>
  );
  if (status === "printer_offline") return (
    <span className="flex items-center gap-1.5 text-xs text-amber-600 px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/8">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
      Printer offline
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs text-primary px-2.5 py-1 rounded-full border border-primary/20 bg-primary/8 font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 animate-pulse" />
      Ready
    </span>
  );
}

function NavLink({ to, icon: Icon, children }: { to: string; icon: React.ElementType; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-[color,background-color,transform] active:scale-[0.96]"
      activeProps={{ className: "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-foreground bg-accent font-medium" }}
    >
      <Icon size={14} />
      {children}
    </Link>
  );
}

function SiteHeader({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="relative flex-shrink-0 border-b border-border h-12 bg-secondary/60">
      <div className="absolute left-0 top-0 h-full px-5 flex items-center gap-2">
        <Printer size={16} className="text-primary" />
        <span className="font-bold text-sm tracking-tight">printer</span>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">POS-58</span>
      </div>
      <div className="h-full max-w-4xl mx-auto px-6 flex items-center justify-between">
        <nav className="flex items-center gap-0.5">
          <NavLink to="/" icon={LayoutGrid}>Playground</NavLink>
          <NavLink to="/queue" icon={ListOrdered}>Queue</NavLink>
          <NavLink to="/keys" icon={KeyRound}>Keys</NavLink>
          <NavLink to="/wall-users" icon={Users}>Wall</NavLink>
          <NavLink to="/docs" icon={BookOpen}>Docs</NavLink>
        </nav>
        <div className="flex items-center gap-3">
          <AgentStatusBadge />
          <div className="w-px h-4 bg-border" />
          <button
            onClick={onLogout}
            className="text-xs text-muted-foreground hover:text-foreground transition-[color,background-color,transform] active:scale-[0.96] px-2 py-1 rounded-md hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function RootComponent() {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    if (pathname === "/docs") {
      fetchSessionFn().then(({ authenticated }) => setAuthenticated(authenticated));
    }
  }, [pathname]);

  async function handleLogout() {
    try { localStorage.removeItem("docs:apiKey"); } catch {}
    await logoutFn();
    window.location.href = "/login";
  }

  if (pathname === "/docs") {
    if (authenticated === true) {
      return (
        <RootDocument>
          <div className="h-screen flex flex-col overflow-hidden">
            <SiteHeader onLogout={handleLogout} />
            <main className="flex-1 min-h-0 overflow-y-auto">
              <Outlet />
            </main>
          </div>
        </RootDocument>
      );
    }
    return (
      <RootDocument>
        <div className="min-h-screen flex flex-col bg-background">
          <div className="border-b border-border h-12 flex-shrink-0 flex items-center px-6 bg-secondary/60">
            <div className="max-w-4xl w-full mx-auto flex items-center gap-2">
              <Printer size={15} className="text-primary" />
              <span className="font-bold text-sm tracking-tight">printer</span>
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">POS-58</span>
              <span className="mx-2 text-border text-xs">·</span>
              <span className="text-xs text-muted-foreground">API Reference</span>
            </div>
          </div>
          <Outlet />
        </div>
      </RootDocument>
    );
  }

  return (
    <RootDocument>
      <div className="h-screen flex flex-col overflow-hidden">
        <SiteHeader onLogout={handleLogout} />
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
        <DynamicFavicon />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

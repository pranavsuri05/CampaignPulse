"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ChevronRight, ClipboardCheck, LayoutDashboard, Settings, Users, Radio, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/review", label: "Pre-send Review", icon: ClipboardCheck },
  { href: "/analytics", label: "Email Analytics", icon: BarChart3 },
  { href: "/diagnostics", label: "Recipient Diagnostics", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

function crumbs(path: string): string[] {
  if (path === "/") return ["Overview"];
  if (path.startsWith("/campaigns/new")) return ["Pre-send Review", "New campaign"];
  if (path.startsWith("/campaigns/")) return ["Pre-send Review", "Edit campaign"];
  if (path.startsWith("/review/")) return ["Pre-send Review", "Campaign review"];
  const item = NAV.find((n) => n.href !== "/" && path.startsWith(n.href));
  return [item?.label ?? "Campaign Pulse"];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/review" && path.startsWith("/campaigns")));
  const trail = crumbs(path);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b px-5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-white"><Mail className="size-4" /></div>
          <div className="leading-tight"><p className="text-sm font-semibold">Campaign Pulse</p><p className="text-[11px] text-muted-foreground">Event email extension</p></div>
        </div>
        <nav aria-label="Primary" className="flex-1 space-y-0.5 p-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}
              className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active(href) && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary")}>
              <Icon className="size-4" />{label}
            </Link>
          ))}
        </nav>
        <p className="border-t p-4 text-[11px] leading-snug text-muted-foreground">Independent product concept for the Airmeet ecosystem. Not an official Airmeet product.</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-card/90 px-4 backdrop-blur md:px-8">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Campaign Pulse</span>
            {trail.map((t, i) => (
              <span key={t} className="flex items-center gap-1.5">
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <span className={i === trail.length - 1 ? "font-medium" : "text-muted-foreground"}>{t}</span>
              </span>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span data-testid="sim-banner" className="hidden items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1 text-xs font-medium text-warning lg:inline-flex">
              <Radio className="size-3" />Simulation Mode — No real emails are being sent.
            </span>
            <div className="flex items-center gap-2" title="Workspace">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">EO</div>
              <div className="hidden text-xs leading-tight lg:block"><p className="font-medium">Event Organizer</p><p className="text-muted-foreground">Local workspace</p></div>
            </div>
          </div>
        </header>
        <div className="lg:hidden border-b bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">Simulation Mode — No real emails are being sent.</div>
        <nav aria-label="Primary mobile" className="flex gap-1 overflow-x-auto border-b bg-card px-3 py-2 md:hidden">
          {NAV.map(({ href, label }) => (
            <Link key={href} href={href} className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground", active(href) && "bg-primary-soft text-primary")}>{label}</Link>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

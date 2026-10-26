"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, FolderTree, LayoutDashboard, Repeat, Settings, Target } from "lucide-react";
import { useDashboardHref } from "./dashboard-href";
import { Logo } from "./logo";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Daily", icon: CalendarDays },
  // Side nav only: the bottom nav has five slots, and Daily links to it on phones.
  { href: "/transactions/recurring", label: "Recurring", icon: Repeat, sideOnly: true },
  { href: "/categories", label: "Categories", icon: FolderTree },
  { href: "/budgets", label: "Budgets", icon: Target },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/** The longest matching link wins, so Recurring doesn't also light up Daily. */
function useActive() {
  const pathname = usePathname();
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const current = LINKS.filter((l) => matches(l.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return (href: string) => current?.href === href;
}

/** Nav links, with the dashboard pointing at the range the user last picked. */
function useLinks() {
  const dashboardHref = useDashboardHref();
  return LINKS.map((link) => ({ ...link, to: link.href === "/dashboard" ? dashboardHref : link.href }));
}

export function LogoLink() {
  return (
    <Link href={useDashboardHref()} className="rounded-lg px-1 focus-visible:outline-2 focus-visible:outline-ring">
      <Logo />
    </Link>
  );
}

export function SideNav() {
  const isActive = useActive();
  const links = useLinks();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {links.map(({ href, to, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={to}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring ${
              active ? "bg-primary/15 text-fg" : "text-muted hover:bg-sunken hover:text-fg active:bg-sunken"
            }`}
          >
            <Icon className={`size-5 ${active ? "text-primary" : ""}`} aria-hidden />
            <span className="max-w-full truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const links = useLinks().filter((link) => !("sideOnly" in link));
  // No Recurring tab here, so Daily stays highlighted on its pages.
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-x-0 border-b-0 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:hidden"
    >
      {links.map(({ href, to, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={to}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[0.6875rem] font-medium min-[360px]:text-xs transition-colors duration-150 active:bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
              active ? "text-fg" : "text-subtle"
            }`}
          >
            <Icon className={`size-5 ${active ? "text-primary" : ""}`} aria-hidden />
            <span className="max-w-full truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import clsx from "clsx";
import {
  Activity,
  AlertOctagon,
  BookOpen,
  Bot,
  CalendarDays,
  Crosshair,
  FileStack,
  GraduationCap,
  Home,
  ListChecks,
  LineChart,
  ListTodo,
  Menu,
  NotebookPen,
  Settings,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  later?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/documents", label: "Documents", icon: FileStack },
  { href: "/assistant", label: "Assistant", icon: Bot },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/planner", label: "Daily plan", icon: ListChecks },
  { href: "/focus", label: "Focus mode", icon: Crosshair },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/reviews", label: "Reviews", icon: NotebookPen },
  { href: "/errors", label: "Errors", icon: AlertOctagon },
  { href: "/learning", label: "Learning", icon: GraduationCap },
  { href: "/growth", label: "Growth", icon: Sprout },
  { href: "/insights", label: "Insights", icon: LineChart },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/activity", label: "Activity log", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();
  const moreActive = !PRIMARY_NAV.some((i) => isActive(pathname, i.href));
  const items = [...PRIMARY_NAV, { href: "/more", label: "More", icon: Menu }];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Main"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = item.href === "/more" ? moreActive : isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={clsx(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-brand-700" : "text-slate-500",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const render = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={clsx(
            "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium",
            active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
          )}
          aria-current={active ? "page" : undefined}
        >
          <Icon className="h-4 w-4" aria-hidden />
          <span className="flex-1">{item.label}</span>
          {item.later && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">LATER</span>}
        </Link>
      </li>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 md:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
        <span className="font-bold leading-tight text-slate-900">
          Wispex
          <span className="block text-xs font-medium text-slate-500">Work Copilot</span>
        </span>
      </Link>
      <nav aria-label="Main" className="flex-1 overflow-y-auto">
        <ul className="space-y-0.5">{PRIMARY_NAV.map(render)}</ul>
        <hr className="my-3 border-slate-200" />
        <ul className="space-y-0.5">{SECONDARY_NAV.map(render)}</ul>
      </nav>
      <p className="px-3 pt-4 text-[11px] leading-snug text-slate-400">
        Progress → Verify → Refer → Escalate → Document → Improve
      </p>
    </aside>
  );
}

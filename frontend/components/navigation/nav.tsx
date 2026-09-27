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
  LogOut,
  Menu,
  NotebookPen,
  Settings,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { api } from "@/lib/api/client";
import { useMe } from "@/lib/hooks";
import { LanguageToggle, t } from "@/lib/i18n";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  later?: boolean;
}

/** Nav entry whose label follows the active language. */
function navItem(href: string, en: string, id: string, icon: LucideIcon, later = false): NavItem {
  return {
    href,
    icon,
    later,
    get label() {
      return t(en, id);
    },
  };
}

export const PRIMARY_NAV: NavItem[] = [
  navItem("/", "Home", "Beranda", Home),
  navItem("/tasks", "Tasks", "Task", ListTodo),
  navItem("/documents", "Documents", "Dokumen", FileStack),
  navItem("/assistant", "Assistant", "Asisten", Bot),
];

export const SECONDARY_NAV: NavItem[] = [
  navItem("/planner", "Daily plan", "Rencana harian", ListChecks),
  navItem("/focus", "Focus mode", "Mode fokus", Crosshair),
  navItem("/calendar", "Calendar", "Kalender", CalendarDays),
  navItem("/reviews", "Reviews", "Refleksi", NotebookPen),
  navItem("/errors", "Errors", "Kesalahan", AlertOctagon),
  navItem("/learning", "Learning", "Belajar", GraduationCap),
  navItem("/growth", "Growth", "Perkembangan", Sprout),
  navItem("/insights", "Insights", "Insight", LineChart),
  navItem("/knowledge", "Knowledge", "Pengetahuan", BookOpen),
  navItem("/activity", "Activity log", "Log aktivitas", Activity),
  navItem("/settings", "Settings", "Pengaturan", Settings),
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();
  const moreActive = !PRIMARY_NAV.some((i) => isActive(pathname, i.href));
  const items = [...PRIMARY_NAV, navItem("/more", "More", "Lainnya", Menu)];
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

/** Ends the session on the server, clears cached data, and goes to the sign-in page. */
export function useSignOut() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    await api.post("/api/auth/logout").catch(() => undefined);
    await mutate(() => true, undefined, { revalidate: false });
    router.replace("/login");
  }
  return { signOut, signingOut };
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: user } = useMe();
  const { signOut, signingOut } = useSignOut();
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
          {item.later && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">{t("LATER", "NANTI")}</span>}
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
      <div className="mt-3 border-t border-slate-200 pt-3">
        {user && (
          <p className="truncate px-3 text-xs text-slate-500" title={user.email}>
            {user.email}
          </p>
        )}
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {signingOut ? t("Signing out…", "Keluar…") : t("Sign out", "Keluar")}
        </button>
        <LanguageToggle className="mx-3 mt-2" />
        <p className="px-3 pt-3 text-[11px] leading-snug text-slate-400">
          Progress → Verify → Refer → Escalate → Document → Improve
        </p>
      </div>
    </aside>
  );
}

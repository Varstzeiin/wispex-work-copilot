"use client";

import { ChevronRight, LogOut } from "lucide-react";
import Link from "next/link";

import { SECONDARY_NAV, useSignOut } from "@/components/navigation/nav";
import { PageHeader } from "@/components/ui";
import { useMe } from "@/lib/hooks";
import { LanguageToggle, t } from "@/lib/i18n";

export default function MorePage() {
  const { data: user } = useMe();
  const { signOut, signingOut } = useSignOut();

  return (
    <div>
      <PageHeader title={t("More", "Lainnya")} subtitle={user?.email} />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {SECONDARY_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link href={item.href} className="flex min-h-14 items-center gap-3 px-4 text-slate-800 hover:bg-slate-50">
                <Icon className="h-5 w-5 text-slate-500" aria-hidden />
                <span className="flex-1 font-medium">{item.label}</span>
                {item.later && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">{t("LATER", "NANTI")}</span>}
                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        onClick={signOut}
        disabled={signingOut}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white font-semibold text-red-700"
      >
        <LogOut className="h-4 w-4" aria-hidden /> {signingOut ? t("Signing out…", "Keluar…") : t("Sign out", "Keluar")}
      </button>
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <span className="font-medium text-slate-800">{t("Language", "Bahasa")}</span>
        <LanguageToggle />
      </div>
      <p className="mt-6 text-center text-xs text-slate-400">
        Progress → Verify → Refer → Escalate → Document → Improve
      </p>
    </div>
  );
}

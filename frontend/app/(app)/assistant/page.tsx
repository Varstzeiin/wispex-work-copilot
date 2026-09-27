"use client";

import { Mail, ShieldQuestion } from "lucide-react";
import Link from "next/link";

import { AskPanel } from "@/components/assistant/AskPanel";
import { ClarificationList } from "@/components/assistant/ClarificationList";
import { InsightsCard } from "@/components/assistant/InsightsCard";
import { NextActionPanel } from "@/components/assistant/NextActionPanel";
import { PageHeader, SectionTitle } from "@/components/ui";
import { t } from "@/lib/i18n";

export default function AssistantPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Assistant", "Asisten")}
        subtitle={t("Suggestions and drafts only. You verify, decide and send.", "Hanya saran dan draf. Kamu yang memverifikasi, memutuskan, dan mengirim.")}
      />
      <NextActionPanel />

      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/assistant/unsure"
          className="flex min-h-20 flex-col justify-center rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950 hover:bg-amber-100"
        >
          <ShieldQuestion className="h-5 w-5" aria-hidden />
          <span className="mt-1 font-semibold">{t("I'm not sure", "Aku tidak yakin")}</span>
          <span className="text-xs text-amber-800">{t("Check sources, then ask precisely", "Cek sumber, lalu tanya dengan jelas")}</span>
        </Link>
        <Link
          href="/assistant/drafts"
          className="flex min-h-20 flex-col justify-center rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 hover:bg-slate-50"
        >
          <Mail className="h-5 w-5 text-brand-600" aria-hidden />
          <span className="mt-1 font-semibold">{t("Draft a message", "Buat draf pesan")}</span>
          <span className="text-xs text-slate-500">{t("Clarification, missing docs, status…", "Klarifikasi, dokumen kurang, status…")}</span>
        </Link>
      </div>

      <AskPanel />

      <section>
        <SectionTitle>{t("Open questions", "Pertanyaan terbuka")}</SectionTitle>
        <ClarificationList />
      </section>

      <InsightsCard />
    </div>
  );
}

"use client";

import { Mail, ShieldQuestion } from "lucide-react";
import Link from "next/link";

import { AskPanel } from "@/components/assistant/AskPanel";
import { ClarificationList } from "@/components/assistant/ClarificationList";
import { InsightsCard } from "@/components/assistant/InsightsCard";
import { NextActionPanel } from "@/components/assistant/NextActionPanel";
import { PageHeader, SectionTitle } from "@/components/ui";

export default function AssistantPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Assistant" subtitle="Suggestions and drafts only. You verify, decide and send." />
      <NextActionPanel />

      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/assistant/unsure"
          className="flex min-h-20 flex-col justify-center rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950 hover:bg-amber-100"
        >
          <ShieldQuestion className="h-5 w-5" aria-hidden />
          <span className="mt-1 font-semibold">I&apos;m not sure</span>
          <span className="text-xs text-amber-800">Check sources, then ask precisely</span>
        </Link>
        <Link
          href="/assistant/drafts"
          className="flex min-h-20 flex-col justify-center rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 hover:bg-slate-50"
        >
          <Mail className="h-5 w-5 text-brand-600" aria-hidden />
          <span className="mt-1 font-semibold">Draft a message</span>
          <span className="text-xs text-slate-500">Clarification, missing docs, status…</span>
        </Link>
      </div>

      <AskPanel />

      <section>
        <SectionTitle>Open questions</SectionTitle>
        <ClarificationList />
      </section>

      <InsightsCard />
    </div>
  );
}

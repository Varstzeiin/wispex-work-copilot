"use client";

import clsx from "clsx";
import { BadgeCheck, NotebookText } from "lucide-react";
import Link from "next/link";

import type { KnowledgeResult } from "@/types";

function href(r: KnowledgeResult): string | null {
  if (r.kind === "NOTE") return `/knowledge?note=${r.id}`;
  if (r.kind === "LEARNING") return "/learning";
  if (r.kind === "ERROR") return `/errors/${r.id}`;
  return null;
}

/** Trusted sources found by the local search. Numbered, so an answer can cite them as [1], [2]. */
export function SourceList({ sources, cited = [] }: { sources: KnowledgeResult[]; cited?: string[] }) {
  return (
    <ol className="space-y-2">
      {sources.map((s, i) => {
        const link = href(s);
        const title = (
          <span className="font-semibold text-slate-900">
            [{i + 1}] {s.title}
          </span>
        );
        return (
          <li
            key={`${s.kind}-${s.id}`}
            className={clsx("rounded-xl border p-3 text-sm", cited.includes(s.id) ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white")}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {link ? (
                <Link href={link} className="hover:underline">
                  {title}
                </Link>
              ) : (
                title
              )}
              {s.match === "meaning" && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">Similar meaning</span>
              )}
              {s.verified ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Confirmed
                </span>
              ) : (
                <span className="text-xs text-slate-500">Not confirmed</span>
              )}
            </div>
            {s.snippet && <p className="mt-1 text-slate-700">{s.snippet}</p>}
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
              <NotebookText className="h-3.5 w-3.5" aria-hidden />
              {s.origin_label}
              {s.source_label && ` · ${s.source_label}`}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

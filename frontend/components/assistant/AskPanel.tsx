"use client";

import { BookOpen, Search, ShieldQuestion } from "lucide-react";
import { useState } from "react";

import { SourceList } from "@/components/assistant/SourceList";
import { Button, Card, InlineError, inputClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import type { AskResult } from "@/types";

/** Knowledge-first: search trusted sources before asking someone. */
export function AskPanel() {
  const online = useOnline();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<AskResult>("/api/assistant/ask", { question: question.trim() }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <BookOpen className="h-4 w-4 text-brand-600" aria-hidden /> Search trusted knowledge
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">Training notes, SOP references, your notes, resolved cases and senior notes.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length >= 3) ask();
        }}
      >
        <input
          className={inputClass}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What if the quantity differs between Invoice and Packing List?"
          aria-label="Your question"
          maxLength={500}
        />
        <Button type="submit" loading={busy} disabled={!online || question.trim().length < 3} aria-label="Search">
          <Search className="h-4 w-4" aria-hidden />
        </Button>
      </form>
      <div className="mt-2">
        <InlineError message={error} />
      </div>

      {result && (
        <div className="mt-3 space-y-3" aria-live="polite">
          {result.status === "ANSWERED" ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">Answer from your sources</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{result.answer}</p>
              <p className="mt-2 text-xs text-slate-600">{result.message}</p>
            </div>
          ) : (
            <p
              className={`flex items-start gap-2 rounded-xl p-3 text-sm ${
                result.status === "SOURCES_ONLY" ? "bg-slate-50 text-slate-700" : "bg-amber-50 text-amber-900"
              }`}
            >
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {result.message}
            </p>
          )}
          {result.sources.length > 0 && <SourceList sources={result.sources} cited={result.used_source_ids} />}
        </div>
      )}
    </Card>
  );
}

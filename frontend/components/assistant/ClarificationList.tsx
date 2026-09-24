"use client";

import { MessageCircleQuestion, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, EmptyState, Field, InlineError, Modal, inputClass } from "@/components/ui";
import { useClarifications, useRefreshAssistant } from "@/features/assistant/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { formatDateTime } from "@/lib/utils/time";
import type { Clarification } from "@/types";

/** Questions and escalations still waiting for an answer. Recording the answer closes the task issue. */
export function ClarificationList({ taskId, compact = false }: { taskId?: string; compact?: boolean }) {
  const online = useOnline();
  const { timezone } = useSettings();
  const refresh = useRefreshAssistant();
  const { data } = useClarifications("open", taskId);
  const [active, setActive] = useState<Clarification | null>(null);
  const [answer, setAnswer] = useState("");
  const [save, setSave] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;
  if (data.items.length === 0) {
    return compact ? null : <EmptyState title="No open questions">Questions you ask through “I&apos;m not sure” appear here until you record the answer.</EmptyState>;
  }

  function open(c: Clarification) {
    setActive(c);
    setAnswer("");
    setSave(true);
    setVerified(false);
    setError(null);
  }

  async function submit(kind: "answer" | "cancel") {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "answer") {
        await api.post(`/api/assistant/clarifications/${active.id}/answer`, { answer, save_to_knowledge: save, verified });
      } else {
        await api.post(`/api/assistant/clarifications/${active.id}/cancel`);
      }
      await refresh();
      setActive(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="space-y-2">
        {data.items.map((c) => (
          <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900">
                {c.kind === "ESCALATION" ? (
                  <TriangleAlert className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
                ) : (
                  <MessageCircleQuestion className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                )}
                <span className="truncate">
                  {c.kind === "ESCALATION" ? "Escalated" : "Asked"}
                  {c.asked_to && ` ${c.asked_to}`}: {c.field_name || c.issue}
                </span>
              </p>
              <Button variant="secondary" onClick={() => open(c)} disabled={!online} className="shrink-0">
                Record answer
              </Button>
            </div>
            <p className="mt-1 line-clamp-2 text-slate-600">{c.question}</p>
            <p className="mt-1 text-xs text-slate-500">
              {c.shipment_reference && c.task_id && !taskId && (
                <>
                  <Link href={`/tasks/${c.task_id}`} className="font-semibold text-brand-700">
                    {c.shipment_reference}
                  </Link>{" "}
                  ·{" "}
                </>
              )}
              {formatDateTime(c.created_at, timezone)}
            </p>
          </li>
        ))}
      </ul>

      <Modal open={!!active} title="Record the answer" onClose={() => setActive(null)}>
        {active && (
          <div className="space-y-3">
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{active.question}</p>
            <Field label="Answer you received" htmlFor="answer" hint="Write it as you received it. Include who answered if that matters.">
              <textarea id="answer" rows={4} className={inputClass} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={3000} />
            </Field>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={save} onChange={(e) => setSave(e.target.checked)} />
              <span>Save to my knowledge base as a resolved question</span>
            </label>
            {save && (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
                <span>The answer came from a senior, supervisor or official source (mark as confirmed)</span>
              </label>
            )}
            <InlineError message={error} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => submit("cancel")} disabled={busy}>
                No longer needed
              </Button>
              <Button onClick={() => submit("answer")} loading={busy} disabled={!answer.trim() || !online}>
                Save answer
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

"use client";

import clsx from "clsx";
import { Mail, Scale } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge, Button, Field, InlineError, Modal, inputClass } from "@/components/ui";
import { useRefreshDocuments } from "@/features/document-ai/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { DISCREPANCY_STATUS, DOC_FIELD_LABEL } from "@/lib/utils/labels";
import type { DiscrepancyItem } from "@/types";

/** A potential mismatch. The app shows both values and never says which document is correct. */
export function DiscrepancyCard({ d }: { d: DiscrepancyItem }) {
  const refresh = useRefreshDocuments();
  const online = useOnline();
  const [action, setAction] = useState<"RESOLVED" | "DISMISSED" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = d.status === "OPEN";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/discrepancies/${d.id}/resolve`, { status: action, note });
      await refresh();
      setAction(null);
      setNote("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={clsx("rounded-2xl border bg-white p-4", open ? "border-red-200" : "border-slate-200 opacity-80")}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900">
          <Scale className="h-4 w-4 text-red-600" aria-hidden />
          {open ? "Potential mismatch" : "Mismatch"}: {DOC_FIELD_LABEL[d.field] ?? d.field}
        </h3>
        <Badge className={DISCREPANCY_STATUS[d.status].style}>{DISCREPANCY_STATUS[d.status].label}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 p-2.5">
          <dt className="text-xs text-slate-500">{d.document_a}</dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">{d.value_a || "—"}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <dt className="text-xs text-slate-500">{d.document_b}</dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">{d.value_b || "—"}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-600">
        {d.difference && d.difference !== "different" && <>Difference: <strong>{d.difference}</strong> · </>}
        Reading confidence: {Math.round(d.confidence * 100)}%
      </p>
      {open ? (
        <>
          <p className="mt-2 text-sm text-slate-700">{d.potential_impact}</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{d.recommended_action}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={!online} onClick={() => setAction("RESOLVED")}>
              Record resolution
            </Button>
            <Button variant="secondary" disabled={!online} onClick={() => setAction("DISMISSED")}>
              Not a real issue
            </Button>
            {d.task_id && (
              <Link
                href={`/assistant/drafts?kind=DISCREPANCY&task=${d.task_id}&discrepancy=${d.id}`}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                <Mail className="h-4 w-4" aria-hidden /> Draft a message
              </Link>
            )}
          </div>
        </>
      ) : (
        d.resolution_note && <p className="mt-2 text-sm text-slate-700">Note: {d.resolution_note}</p>
      )}

      <Modal open={action !== null} title={action === "RESOLVED" ? "Record resolution" : "Dismiss as not an issue"} onClose={() => setAction(null)}>
        <div className="space-y-3">
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            {d.document_a}: <strong>{d.value_a}</strong> · {d.document_b}: <strong>{d.value_b}</strong>
          </p>
          <Field
            label={action === "RESOLVED" ? "Which value applies, and who confirmed it?" : "Why is this not a real issue?"}
            htmlFor="resolution-note"
            hint="Saved with the discrepancy and added to the linked task's notes."
          >
            <textarea id="resolution-note" rows={3} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <InlineError message={error} />
          <Button block loading={busy} disabled={!note.trim()} onClick={submit}>
            Save
          </Button>
        </div>
      </Modal>
    </section>
  );
}

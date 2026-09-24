"use client";

import clsx from "clsx";
import { Check, CheckCircle2, Pencil, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button, InlineError, Modal, inputClass } from "@/components/ui";
import { useRefreshDocuments } from "@/features/document-ai/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { DOC_FIELD_LABEL, confidenceStyle } from "@/lib/utils/labels";
import type { DocField, DocumentItem } from "@/types";

const NUMERIC = new Set(["total_value", "quantity", "gross_weight", "net_weight"]);

/**
 * Per-field view (spec section 6 and 11): verified values can be used while uncertain ones stay
 * pending. Every AI value shows its confidence, and a person can confirm or correct it.
 */
export function FieldTable({ doc, onlyPresent = false }: { doc: DocumentItem; onlyPresent?: boolean }) {
  const refresh = useRefreshDocuments();
  const online = useOnline();
  const [editing, setEditing] = useState<DocField | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fields = doc.fields.filter((f) => !onlyPresent || f.value !== null || f.status === "NEEDS_REVIEW");

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {fields.map((f) => {
          const review = f.status === "NEEDS_REVIEW";
          return (
            <li key={f.name} className={clsx("py-2.5", review && "-mx-2 rounded-xl bg-amber-50 px-2")}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0" aria-hidden>
                  {f.status === "VERIFIED" ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : review ? (
                    <TriangleAlert className="h-5 w-5 text-amber-600" />
                  ) : (
                    <Check className="h-5 w-5 text-emerald-500" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{DOC_FIELD_LABEL[f.name] ?? f.name}</span>
                    <span className="text-xs">
                      {f.source === "HUMAN" ? (
                        <span className="font-semibold text-emerald-700">{f.status === "VERIFIED" ? "Verified by you" : "Entered by you"}</span>
                      ) : f.value !== null ? (
                        <span className={clsx("font-semibold tabular-nums", confidenceStyle(f.confidence))}>
                          AI {Math.round(f.confidence * 100)}%
                        </span>
                      ) : (
                        <span className="text-slate-400">not found</span>
                      )}
                    </span>
                  </div>
                  <p className={clsx("break-words text-sm", f.value === null ? "italic text-slate-400" : "font-medium text-slate-900")}>
                    {f.value ?? "—"}
                    {f.normalized && f.value && f.normalized !== f.value && (
                      <span className="ml-2 text-xs font-normal text-slate-500">→ {f.normalized}</span>
                    )}
                  </p>
                  {f.rule_messages.map((m) => (
                    <p key={m} className="text-xs text-amber-800">
                      ⚠️ {m}
                    </p>
                  ))}
                  {review && !f.rule_messages.length && f.value !== null && (
                    <p className="text-xs text-amber-800">⚠️ Low confidence. Check against the source document.</p>
                  )}
                  {f.evidence && f.source === "AI" && <p className="text-[11px] text-slate-400">Found at: {f.evidence}</p>}
                  {f.status !== "VERIFIED" && (
                    <div className="mt-1.5 flex gap-2">
                      {f.value !== null && !f.rule_messages.length && (
                        <button
                          onClick={() => run(f.name, () => api.post(`/api/documents/${doc.id}/fields/${f.name}/confirm`))}
                          disabled={!online || busy !== null}
                          className="rounded-lg border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                        >
                          {busy === f.name ? "Saving…" : "Confirm value"}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditing(f);
                          setValue(f.normalized && NUMERIC.has(f.name) ? f.normalized : (f.value ?? ""));
                          setError(null);
                        }}
                        disabled={!online || busy !== null}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                      >
                        <Pencil className="h-3 w-3" aria-hidden /> {f.value === null ? "Enter value" : "Correct"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!editing && <InlineError message={error} />}

      <Modal open={editing !== null} title={editing ? DOC_FIELD_LABEL[editing.name] ?? editing.name : ""} onClose={() => setEditing(null)}>
        <div className="space-y-3">
          {editing?.value && (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              AI reading: <strong>{editing.value}</strong>
              {editing.source === "AI" && ` (${Math.round(editing.confidence * 100)}%)`}
            </p>
          )}
          <label className="block text-sm font-medium text-slate-700" htmlFor="field-value">
            Value from the source document
          </label>
          <input
            id="field-value"
            className={inputClass}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={editing && NUMERIC.has(editing.name) ? "decimal" : undefined}
          />
          {editing && NUMERIC.has(editing.name) && (
            <p className="text-xs text-slate-500">Use a dot for decimals and no thousands separators, for example 1500 or 1500.50.</p>
          )}
          {editing && (editing.name.endsWith("_date")) && <p className="text-xs text-slate-500">Format: YYYY-MM-DD</p>}
          <InlineError message={error} />
          <Button
            block
            loading={busy === "edit"}
            onClick={async () => {
              if (editing && (await run("edit", () => api.put(`/api/documents/${doc.id}/fields/${editing.name}`, { value: value || null })))) {
                setEditing(null);
              }
            }}
          >
            Save as verified
          </Button>
          <p className="text-xs text-slate-500">Saved values count as checked by you. They are compared with the other documents again.</p>
        </div>
      </Modal>
    </div>
  );
}

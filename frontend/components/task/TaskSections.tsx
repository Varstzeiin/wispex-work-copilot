"use client";

import clsx from "clsx";
import { Check, CheckCircle2, Circle, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button, Card, Field, InlineError, Modal, SectionTitle, inputClass } from "@/components/ui";
import { taskApi, useRefreshTaskData } from "@/features/task-management/hooks";
import { errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { FACTOR_LABEL, ISSUE_LABEL } from "@/lib/utils/labels";
import type { Issue, IssueType, Task } from "@/types";

/** Required documents with a one-tap "received" toggle. Supports progressing while waiting. */
export function DocumentChecklist({ task, disabled }: { task: Task; disabled?: boolean }) {
  const refresh = useRefreshTaskData();
  const online = useOnline();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(doc: string) {
    setBusy(doc);
    setError(null);
    const has = task.available_documents.includes(doc);
    const next = has ? task.available_documents.filter((d) => d !== doc) : [...task.available_documents, doc];
    try {
      await taskApi.update(task.id, { available_documents: next });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const done = task.required_documents.length - task.missing_documents.length;
  return (
    <Card>
      <SectionTitle>
        Documents {done}/{task.required_documents.length}
      </SectionTitle>
      {task.required_documents.length === 0 ? (
        <p className="text-sm text-slate-500">No required documents set. Edit the task to add them.</p>
      ) : (
        <ul className="space-y-1.5">
          {task.required_documents.map((doc) => {
            const has = task.available_documents.includes(doc);
            return (
              <li key={doc}>
                <button
                  onClick={() => toggle(doc)}
                  disabled={disabled || !online || busy !== null}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm disabled:opacity-60"
                  aria-pressed={has}
                >
                  {has ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
                  ) : (
                    <Circle className="h-5 w-5 text-orange-500" aria-hidden />
                  )}
                  <span className="flex-1 font-medium text-slate-800">{doc}</span>
                  <span className={clsx("text-xs font-semibold", has ? "text-emerald-700" : "text-orange-700")}>
                    {busy === doc ? "Saving…" : has ? "Received" : "Missing"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Tap to mark a document as received. Uploaded documents are marked automatically once their type is known.
      </p>
      <div className="mt-2">
        <InlineError message={error} />
      </div>
    </Card>
  );
}

const ISSUE_TYPES = Object.keys(ISSUE_LABEL) as IssueType[];

/** Known issues. Resolving one requires writing down how it was resolved. */
export function IssueList({ task, disabled }: { task: Task; disabled?: boolean }) {
  const refresh = useRefreshTaskData();
  const online = useOnline();
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState<Issue | null>(null);
  const [type, setType] = useState<IssueType>("QUANTITY_MISMATCH");
  const [description, setDescription] = useState("");
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(issues: Issue[], note?: string) {
    setSaving(true);
    setError(null);
    try {
      await taskApi.update(task.id, note ? { issues, notes: note } : { issues });
      await refresh();
      setAdding(false);
      setResolving(null);
      setDescription("");
      setResolution("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function addIssue() {
    if (!description.trim()) return;
    save([...task.issues, { id: "", type, description: description.trim(), resolved: false }]);
  }

  function resolveIssue() {
    if (!resolving || !resolution.trim()) return;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const line = `[${stamp} UTC] Resolved "${ISSUE_LABEL[resolving.type]}": ${resolution.trim()}`;
    save(
      task.issues.map((i) => (i.id === resolving.id ? { ...i, resolved: true } : i)),
      task.notes ? `${task.notes}\n${line}` : line,
    );
  }

  function reopen(issue: Issue) {
    save(task.issues.map((i) => (i.id === issue.id ? { ...i, resolved: false } : i)));
  }

  const open = task.issues.filter((i) => !i.resolved);
  const resolved = task.issues.filter((i) => i.resolved);

  return (
    <Card>
      <SectionTitle
        action={
          !disabled && (
            <button
              onClick={() => setAdding(true)}
              disabled={!online}
              className="flex items-center gap-1 text-sm font-semibold text-brand-700 disabled:text-slate-400"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add issue
            </button>
          )
        }
      >
        Issues {open.length > 0 && `· ${open.length} open`}
      </SectionTitle>
      {task.issues.length === 0 && <p className="text-sm text-slate-500">No issues recorded.</p>}
      <ul className="space-y-2">
        {open.map((issue) => (
          <li key={issue.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-semibold text-amber-900">⚠️ {ISSUE_LABEL[issue.type]}</p>
            <p className="mt-0.5 text-amber-900">{issue.description}</p>
            {!disabled && (
              <button
                onClick={() => setResolving(issue)}
                disabled={!online}
                className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-900 underline disabled:no-underline disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" aria-hidden /> Mark resolved
              </button>
            )}
          </li>
        ))}
        {resolved.map((issue) => (
          <li key={issue.id} className="rounded-xl border border-slate-200 p-3 text-sm text-slate-500">
            <p className="font-medium line-through">{ISSUE_LABEL[issue.type]}</p>
            <p className="mt-0.5">{issue.description}</p>
            {!disabled && (
              <button onClick={() => reopen(issue)} disabled={!online} className="mt-1 flex items-center gap-1 text-xs font-semibold underline">
                <RotateCcw className="h-3 w-3" aria-hidden /> Reopen
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        The app never decides which document is correct. Verify against source documents and follow the applicable SOP.
      </p>

      <Modal open={adding} title="Record an issue" onClose={() => setAdding(false)}>
        <div className="space-y-3">
          <Field label="Type" htmlFor="issue-type">
            <select id="issue-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as IssueType)}>
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ISSUE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What exactly did you find?" htmlFor="issue-desc" hint="Be specific: field, both values, both documents.">
            <textarea
              id="issue-desc"
              rows={3}
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Invoice net weight 850 KG vs Packing List 890 KG"
            />
          </Field>
          <InlineError message={error} />
          <Button block onClick={addIssue} loading={saving} disabled={!description.trim()}>
            Save issue
          </Button>
        </div>
      </Modal>

      <Modal open={resolving !== null} title="Resolve issue" onClose={() => setResolving(null)}>
        <div className="space-y-3">
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{resolving?.description}</p>
          <Field
            label="How was it resolved?"
            htmlFor="resolution"
            hint="Record the source or instruction, e.g. who confirmed which value. This is added to the task notes."
          >
            <textarea id="resolution" rows={3} className={inputClass} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </Field>
          <InlineError message={error} />
          <Button block onClick={resolveIssue} loading={saving} disabled={!resolution.trim()}>
            Mark resolved
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/** Shows how the score was built, so priority is never a black box. */
export function PriorityBreakdown({ task }: { task: Task }) {
  if (!task.factors.length) return null;
  return (
    <Card>
      <SectionTitle>Why this priority</SectionTitle>
      {task.priority_reasons.length > 0 ? (
        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {task.priority_reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-slate-500">No urgent factors right now.</p>
      )}
      <ul className="space-y-1.5">
        {task.factors.map((f) => (
          <li key={f.name} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2 text-xs text-slate-600">
            <span>{FACTOR_LABEL[f.name] ?? f.name}</span>
            <span className="h-2 overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full bg-brand-500"
                style={{ width: `${f.max_points ? (100 * f.points) / f.max_points : 0}%` }}
              />
            </span>
            <span className="text-right tabular-nums">
              {Math.round(f.points)}/{f.max_points}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Weights are your personal settings, not company policy.</p>
    </Card>
  );
}

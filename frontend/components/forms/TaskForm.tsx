"use client";

import clsx from "clsx";
import { Check, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button, Field, InlineError, inputClass } from "@/components/ui";
import type { TaskPayload } from "@/features/task-management/hooks";
import { errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { COMMON_DOCUMENTS } from "@/lib/utils/labels";
import { toLocalInput } from "@/lib/utils/time";
import type { Task } from "@/types";

interface Props {
  initial?: Task;
  timeZone: string;
  submitLabel: string;
  onSubmit: (payload: TaskPayload) => Promise<void>;
  onCancel: () => void;
}

export function TaskForm({ initial, timeZone, submitLabel, onSubmit, onCancel }: Props) {
  const online = useOnline();
  const [title, setTitle] = useState(initial?.title ?? "Import declaration data prep");
  const [reference, setReference] = useState(initial?.shipment_reference ?? "");
  const [client, setClient] = useState(initial?.client_name ?? "");
  const [slaTier, setSlaTier] = useState(initial?.client_sla_tier ?? "");
  const [mode, setMode] = useState(initial?.transport_mode ?? "");
  const [eta, setEta] = useState(toLocalInput(initial?.eta, timeZone));
  const [deadline, setDeadline] = useState(toLocalInput(initial?.submission_deadline, timeZone));
  const [estimate, setEstimate] = useState(String(initial?.estimated_minutes ?? 20));
  const [required, setRequired] = useState<string[]>(
    initial?.required_documents ?? ["Commercial Invoice", "Packing List", "Bill of Lading"],
  );
  const [available, setAvailable] = useState<string[]>(initial?.available_documents ?? []);
  const [customDoc, setCustomDoc] = useState("");
  const [action, setAction] = useState(initial?.assigned_action ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, doc: string) =>
    set(list.includes(doc) ? list.filter((d) => d !== doc) : [...list, doc]);

  function addCustomDoc() {
    const name = customDoc.trim();
    if (name && !required.some((d) => d.toLowerCase() === name.toLowerCase())) setRequired([...required, name]);
    setCustomDoc("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Datetimes are sent without an offset: the backend interprets them in your profile timezone
      await onSubmit({
        title: title.trim(),
        shipment_reference: reference.trim() || null,
        client_name: client.trim() || null,
        client_sla_tier: (slaTier || null) as TaskPayload["client_sla_tier"],
        transport_mode: (mode || null) as TaskPayload["transport_mode"],
        eta: eta || null,
        submission_deadline: deadline || null,
        estimated_minutes: Math.max(1, Number(estimate) || 15),
        required_documents: required,
        available_documents: available.filter((d) => required.includes(d)),
        assigned_action: action.trim(),
        notes,
        description: initial?.description ?? "",
      });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const docOptions = Array.from(new Set([...COMMON_DOCUMENTS, ...required]));

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-slate-500">Shipment</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Shipment reference" htmlFor="ref">
            <input id="ref" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. SHP-001" />
          </Field>
          <Field label="Task title" htmlFor="title">
            <input id="title" required className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Client" htmlFor="client">
            <input id="client" className={inputClass} value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Client A" />
          </Field>
          <Field label="Client priority (your setting)" htmlFor="sla" hint="Optional. Only if you know it. Not an official SLA.">
            <select id="sla" className={inputClass} value={slaTier} onChange={(e) => setSlaTier(e.target.value)}>
              <option value="">Not set</option>
              <option value="HIGH">High</option>
              <option value="STANDARD">Standard</option>
              <option value="LOW">Low</option>
            </select>
          </Field>
          <Field label="Transport mode" htmlFor="mode">
            <select id="mode" className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Not set</option>
              <option value="SEA">Sea</option>
              <option value="AIR">Air</option>
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-slate-500">Timing ({timeZone})</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="ETA" htmlFor="eta">
            <input id="eta" type="datetime-local" className={inputClass} value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>
          <Field label="Submission deadline" htmlFor="deadline">
            <input id="deadline" type="datetime-local" className={inputClass} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
          <Field label="Estimated processing (min)" htmlFor="est">
            <input id="est" type="number" min={1} max={1440} inputMode="numeric" className={inputClass} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-slate-500">Documents</legend>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Required for this task</p>
          <div className="flex flex-wrap gap-2">
            {docOptions.map((doc) => (
              <button
                type="button"
                key={doc}
                onClick={() => toggle(required, setRequired, doc)}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-sm",
                  required.includes(doc) ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-slate-300 text-slate-600",
                )}
                aria-pressed={required.includes(doc)}
              >
                {doc}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className={inputClass}
              placeholder="Other document"
              value={customDoc}
              onChange={(e) => setCustomDoc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomDoc();
                }
              }}
              aria-label="Add another required document"
            />
            <Button type="button" variant="secondary" onClick={addCustomDoc} aria-label="Add document">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {required.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Already received</p>
            <ul className="space-y-1.5">
              {required.map((doc) => {
                const has = available.includes(doc);
                return (
                  <li key={doc}>
                    <button
                      type="button"
                      onClick={() => toggle(available, setAvailable, doc)}
                      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-left text-sm"
                      aria-pressed={has}
                    >
                      <span className={clsx("flex h-5 w-5 items-center justify-center rounded-md border", has ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300")}>
                        {has ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <span className="flex-1">{doc}</span>
                      {!has && <span className="text-xs font-semibold text-orange-600">Missing</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-slate-500">Notes</legend>
        <Field label="Next action" htmlFor="action">
          <input id="action" className={inputClass} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Request Packing List from shipper" />
        </Field>
        <Field label="Notes" htmlFor="notes" hint="Keep notes short. Avoid copying confidential document content.">
          <textarea id="notes" rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>

      <InlineError message={error} />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1 sm:flex-none">
          <X className="h-4 w-4" aria-hidden /> Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!online} className="flex-1 sm:flex-none">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { ArrowDown, ArrowUp, Bot, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, Card, Field, Modal, SectionTitle, inputClass } from "@/components/ui";
import { useDocumentSettings, useDocumentStatus } from "@/features/document-ai/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import type { DocumentSettings } from "@/types";

export function DocumentSettingsCard() {
  const online = useOnline();
  const { data: status, mutate: mutateStatus } = useDocumentStatus();
  const { data, mutate } = useDocumentSettings();
  const [threshold, setThreshold] = useState(85);
  const [tolerance, setTolerance] = useState(0);
  const [items, setItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [policyChecked, setPolicyChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!data) return;
    setThreshold(Math.round(data.review_threshold * 100));
    setTolerance(data.weight_tolerance_pct);
    setItems(data.final_checklist);
  }, [data]);

  async function save(body: Record<string, unknown>, ok = "Saved.") {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.put<DocumentSettings>("/api/documents/settings", body);
      await mutate(updated, { revalidate: false });
      await mutateStatus();
      setMessage({ text: ok, ok: true });
      return true;
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data || !status) return null;

  const move = (i: number, dir: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setItems(next);
  };

  return (
    <Card>
      <div id="documents" className="scroll-mt-20" />
      <SectionTitle>Documents</SectionTitle>
      {message && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} role="status">
          {message.text}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 p-3">
        <p className="flex items-center gap-2 font-medium text-slate-900">
          <Bot className="h-4 w-4 text-slate-500" aria-hidden /> AI document reading
        </p>
        {!status.ai_configured ? (
          <p className="mt-1 text-sm text-slate-600">
            <strong>Integration Required.</strong> No AI provider is configured on this server (AI_PROVIDER). Documents are stored
            and fields are entered by hand.
          </p>
        ) : status.is_demo ? (
          <p className="mt-1 text-sm text-slate-600">Not available for demo accounts. Demo uploads are never sent to an AI provider.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Provider: {status.ai_provider === "anthropic" ? `Claude (${status.ai_model})` : status.ai_provider}. When on, uploaded files
              are sent to this provider to read the fields. Every value still needs your review.
            </p>
            <label className="mt-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-800">{data.ai_processing_allowed ? "On" : "Off"}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-600"
                checked={data.ai_processing_allowed}
                disabled={!online || busy}
                onChange={(e) => {
                  if (e.target.checked) {
                    setPolicyChecked(false);
                    setConfirmOpen(true);
                  } else {
                    save({ ai_processing_allowed: false }, "AI document reading switched off.");
                  }
                }}
                aria-label="AI document reading"
              />
            </label>
          </>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={`Review fields below ${threshold}% AI confidence`} htmlFor="threshold" hint="Higher means more fields are checked by hand.">
          <input id="threshold" type="range" min={50} max={99} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full accent-brand-600" />
        </Field>
        <Field label="Weight tolerance (%)" htmlFor="tolerance" hint="0 means any difference is reported. Your setting, not company policy.">
          <input id="tolerance" type="number" min={0} max={10} step={0.1} className={inputClass} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
        </Field>
      </div>
      <Button
        className="mt-3"
        variant="secondary"
        disabled={!online || busy}
        onClick={() => save({ review_threshold: threshold / 100, weight_tolerance_pct: tolerance })}
      >
        Save review settings
      </Button>

      <div className="mt-5">
        <p className="text-sm font-semibold text-slate-800">Final checklist before completing a task</p>
        <p className="text-xs text-slate-500">Your personal checklist. It never changes or replaces official SOP.</p>
        <ul className="mt-2 space-y-1.5">
          {items.map((item, i) => (
            <li key={item} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span className="flex-1">{item}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-slate-400 disabled:opacity-30" aria-label={`Move ${item} up`}>
                <ArrowUp className="h-4 w-4" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded p-1 text-slate-400 disabled:opacity-30" aria-label={`Move ${item} down`}>
                <ArrowDown className="h-4 w-4" />
              </button>
              <button onClick={() => setItems(items.filter((x) => x !== item))} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Remove ${item}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            className={inputClass}
            placeholder="Add a checklist item"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newItem.trim()) {
                setItems([...items, newItem.trim()]);
                setNewItem("");
              }
            }}
            aria-label="New checklist item"
          />
          <Button
            variant="secondary"
            onClick={() => {
              if (newItem.trim()) setItems([...items, newItem.trim()]);
              setNewItem("");
            }}
            aria-label="Add checklist item"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <Button className="mt-3" disabled={!online || busy} onClick={() => save({ final_checklist: items }, "Checklist saved.")}>
          Save checklist
        </Button>
      </div>

      <Modal open={confirmOpen} title="Turn on AI document reading?" onClose={() => setConfirmOpen(false)}>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            Uploaded documents will be sent to{" "}
            <strong>{status.ai_provider === "anthropic" ? `Anthropic (Claude, ${status.ai_model})` : status.ai_provider}</strong> to read the
            fields. Company and client documents may contain confidential information.
          </p>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={policyChecked} onChange={(e) => setPolicyChecked(e.target.checked)} />
            <span>I confirm that my organization&apos;s policy explicitly permits this application and this AI provider to process these documents.</span>
          </label>
          <Button
            block
            loading={busy}
            disabled={!policyChecked}
            onClick={async () => {
              if (await save({ ai_processing_allowed: true, confirm_policy: true }, "AI document reading switched on.")) setConfirmOpen(false);
            }}
          >
            Turn on
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

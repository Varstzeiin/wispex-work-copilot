"use client";

import clsx from "clsx";
import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, PageHeader, Spinner, inputClass } from "@/components/ui";
import { Tabs } from "@/components/ui/Tabs";
import { useFeedback, useLearningItems, useRefreshPerformance, useSkills } from "@/features/performance/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { LEARNING_CATEGORY_LABEL, LEARNING_STATUS } from "@/lib/utils/labels";
import { formatDateTime } from "@/lib/utils/time";
import type { FeedbackItem, LearningItem, LearningStatus, SkillItem } from "@/types";

type Tab = "learning" | "feedback" | "skills";

export default function LearningPage() {
  const [tab, setTab] = useState<Tab>("learning");
  return (
    <div>
      <PageHeader title="Learning" subtitle="Track what you learn, the feedback you apply, and your skills." />
      <Tabs
        label="Learning view"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "learning", label: "Learning tracker" },
          { key: "feedback", label: "Feedback" },
          { key: "skills", label: "Skill matrix" },
        ]}
      />
      {tab === "learning" && <LearningTracker />}
      {tab === "feedback" && <FeedbackLog />}
      {tab === "skills" && <SkillMatrix />}
    </div>
  );
}

/** Small helper for "run a request, refresh everything, show a friendly error". */
function useAction() {
  const refresh = useRefreshPerformance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

// ---------- Learning tracker ----------

const STATUS_ORDER: LearningStatus[] = ["TO_LEARN", "LEARNING", "UNDERSTOOD", "APPLIED"];

function LearningTracker() {
  const { data, error, mutate } = useLearningItems();
  const online = useOnline();
  const { run, busy, error: actionError } = useAction();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LearningItem | null>(null);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  const counts = STATUS_ORDER.map((s) => ({ s, n: data.filter((i) => i.status === s).length }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {counts.map((c) => `${c.n} ${LEARNING_STATUS[c.s].label.toLowerCase()}`).join(" · ")}
        </p>
        <Button onClick={() => setOpen(true)} disabled={!online}>
          <Plus className="h-4 w-4" aria-hidden /> Add
        </Button>
      </div>
      <InlineError message={actionError} />
      {data.length === 0 && (
        <EmptyState title="Nothing tracked yet">Add training topics, SOP references, terms or lessons learned.</EmptyState>
      )}
      <ul className="space-y-2">
        {data.map((item) => {
          const idx = STATUS_ORDER.indexOf(item.status);
          const next = STATUS_ORDER[idx + 1];
          return (
            <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <button className="min-w-0 text-left" onClick={() => setEditing(item)}>
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="text-xs text-slate-500">
                    {LEARNING_CATEGORY_LABEL[item.category]}
                    {item.source && ` · ${item.source}`}
                  </p>
                </button>
                <Badge className={LEARNING_STATUS[item.status].style}>{LEARNING_STATUS[item.status].label}</Badge>
              </div>
              {item.notes && <p className="mt-1.5 text-sm text-slate-600">{item.notes}</p>}
              {next && (
                <button
                  onClick={() => run(() => api.patch(`/api/learning/items/${item.id}`, { status: next }))}
                  disabled={!online || busy}
                  className="mt-2 text-xs font-semibold text-brand-700 disabled:text-slate-400"
                >
                  Mark as {LEARNING_STATUS[next].label.toLowerCase()} →
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <LearningForm open={open || editing !== null} item={editing} onClose={() => { setOpen(false); setEditing(null); }} />
    </div>
  );
}

function LearningForm({ open, item, onClose }: { open: boolean; item: LearningItem | null; onClose: () => void }) {
  const { run, busy, error } = useAction();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("DOCUMENT");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<LearningStatus>("TO_LEARN");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = item?.id ?? (open ? "new" : null);
  if (open && key !== loadedFor) {
    setLoadedFor(key);
    setTitle(item?.title ?? "");
    setCategory(item?.category ?? "DOCUMENT");
    setSource(item?.source ?? "");
    setNotes(item?.notes ?? "");
    setStatus(item?.status ?? "TO_LEARN");
  }

  async function save() {
    const body = { title, category, source, notes, status };
    const ok = await run(() => (item ? api.patch(`/api/learning/items/${item.id}`, body) : api.post("/api/learning/items", body)));
    if (ok) {
      setLoadedFor(null);
      onClose();
    }
  }

  return (
    <Modal open={open} title={item ? "Edit learning item" : "Add learning item"} onClose={() => { setLoadedFor(null); onClose(); }}>
      <div className="space-y-3">
        <Field label="Topic" htmlFor="l-title">
          <input id="l-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gross vs net weight" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="l-cat">
            <select id="l-cat" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(LEARNING_CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="l-status">
            <select id="l-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as LearningStatus)}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {LEARNING_STATUS[s].label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Source" htmlFor="l-source" hint="Where did you learn it? e.g. Training week 1, SOP folder, senior">
          <input id="l-source" className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="l-notes" hint="Your own words. Do not copy confidential SOP text.">
          <textarea id="l-notes" rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <InlineError message={error} />
        <div className="flex gap-2">
          <Button block onClick={save} loading={busy} disabled={!title.trim()}>
            Save
          </Button>
          {item && (
            <Button
              variant="ghost"
              aria-label="Delete learning item"
              disabled={busy}
              onClick={async () => {
                if (await run(() => api.delete(`/api/learning/items/${item.id}`))) {
                  setLoadedFor(null);
                  onClose();
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Feedback ----------

function FeedbackLog() {
  const { data, error, mutate } = useFeedback();
  const { timezone } = useSettings();
  const online = useOnline();
  const { run, busy, error: actionError } = useAction();
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState<FeedbackItem | null>(null);
  const [role, setRole] = useState("Supervisor");
  const [summary, setSummary] = useState("");
  const [plan, setPlan] = useState("");
  const [evidence, setEvidence] = useState("");

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  const applied = data.filter((f) => f.applied).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {applied} of {data.length} applied
        </p>
        <Button onClick={() => setAdding(true)} disabled={!online}>
          <Plus className="h-4 w-4" aria-hidden /> Record feedback
        </Button>
      </div>
      <InlineError message={actionError} />
      {data.length === 0 && <EmptyState title="No feedback recorded">Record feedback with an action plan, then the evidence that you applied it.</EmptyState>}
      <ul className="space-y-2">
        {data.map((f) => (
          <li key={f.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-slate-500">
                {f.from_role || "Feedback"} · {formatDateTime(f.received_at, timezone)}
              </p>
              {f.applied ? (
                <Badge className="bg-emerald-100 text-emerald-800">
                  <Check className="h-3 w-3" aria-hidden /> Applied
                </Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-900">Open</Badge>
              )}
            </div>
            <p className="mt-1 font-medium text-slate-900">{f.summary}</p>
            {f.action_plan && <p className="mt-1 text-slate-600">Plan: {f.action_plan}</p>}
            {f.applied_evidence && <p className="mt-1 text-emerald-800">Evidence: {f.applied_evidence}</p>}
            {!f.applied && (
              <button
                onClick={() => {
                  setApplying(f);
                  setEvidence("");
                }}
                disabled={!online}
                className="mt-2 text-xs font-semibold text-brand-700 disabled:text-slate-400"
              >
                Mark as applied →
              </button>
            )}
          </li>
        ))}
      </ul>

      <Modal open={adding} title="Record feedback" onClose={() => setAdding(false)}>
        <div className="space-y-3">
          <Field label="From (role)" htmlFor="fb-role" hint="A role is enough. No names needed.">
            <input id="fb-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label="What was the feedback?" htmlFor="fb-summary">
            <textarea id="fb-summary" rows={3} className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <Field label="How will you apply it?" htmlFor="fb-plan">
            <textarea id="fb-plan" rows={2} className={inputClass} value={plan} onChange={(e) => setPlan(e.target.value)} />
          </Field>
          <Button
            block
            loading={busy}
            disabled={!summary.trim()}
            onClick={async () => {
              if (await run(() => api.post("/api/learning/feedback", { from_role: role, summary, action_plan: plan }))) {
                setAdding(false);
                setSummary("");
                setPlan("");
              }
            }}
          >
            Save
          </Button>
        </div>
      </Modal>

      <Modal open={applying !== null} title="Feedback applied" onClose={() => setApplying(null)}>
        <div className="space-y-3">
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{applying?.summary}</p>
          <Field label="Evidence that you applied it" htmlFor="fb-evidence" hint="e.g. Last 5 questions included the deadline">
            <textarea id="fb-evidence" rows={2} className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          <Button
            block
            loading={busy}
            disabled={!evidence.trim()}
            onClick={async () => {
              if (applying && (await run(() => api.patch(`/api/learning/feedback/${applying.id}`, { applied: true, applied_evidence: evidence })))) {
                setApplying(null);
              }
            }}
          >
            Mark as applied
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Skill matrix ----------

function SkillMatrix() {
  const { data, error, mutate } = useSkills();
  const online = useOnline();
  const { run, busy, error: actionError } = useAction();
  const [editing, setEditing] = useState<SkillItem | null>(null);
  const [evidence, setEvidence] = useState("");
  const [newSkill, setNewSkill] = useState("");

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  const levels = Object.entries(data.levels).map(([k, v]) => ({ level: Number(k), label: v }));

  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
        Self-assessment with evidence. 0 Not yet · 1 Aware · 2 With guidance · 3 Independent · 4 Can teach others.
      </p>
      <InlineError message={actionError} />
      <ul className="space-y-2">
        {data.skills.map((s) => (
          <li key={s.id} className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <div className="flex items-start justify-between gap-2">
              <button className="min-w-0 text-left" onClick={() => { setEditing(s); setEvidence(s.evidence); }}>
                <p className="font-semibold text-slate-900">{s.name}</p>
                <p className="text-xs text-slate-500">{data.levels[String(s.level)]}</p>
              </button>
              <span className="text-lg font-bold tabular-nums text-slate-900">{s.level}/4</span>
            </div>
            {/* Level picker: segmented, labelled, never color-only */}
            <div className="mt-2 grid grid-cols-5 gap-1" role="radiogroup" aria-label={`${s.name} level`}>
              {levels.map((l) => (
                <button
                  key={l.level}
                  role="radio"
                  aria-checked={s.level === l.level}
                  aria-label={`${l.level}: ${l.label}`}
                  title={l.label}
                  disabled={!online || busy}
                  onClick={() => run(() => api.patch(`/api/learning/skills/${s.id}`, { level: l.level }))}
                  className={clsx(
                    "h-8 rounded-lg text-xs font-semibold",
                    l.level >= 1 && l.level <= s.level ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500",
                    s.level === l.level && "ring-2 ring-brand-700 ring-offset-1",
                  )}
                >
                  {l.level}
                </button>
              ))}
            </div>
            {s.evidence && <p className="mt-2 text-xs text-slate-600">Evidence: {s.evidence}</p>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className={inputClass} placeholder="Add a skill" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} aria-label="New skill name" />
        <Button
          variant="secondary"
          disabled={!online || busy || !newSkill.trim()}
          onClick={async () => {
            if (await run(() => api.post("/api/learning/skills", { name: newSkill }))) setNewSkill("");
          }}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add
        </Button>
      </div>

      <Modal open={editing !== null} title={editing?.name ?? ""} onClose={() => setEditing(null)}>
        <div className="space-y-3">
          <Field label="Evidence for your current level" htmlFor="sk-evidence" hint="e.g. Processed 20 invoices without corrections">
            <textarea id="sk-evidence" rows={3} className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          {editing && editing.history.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Level history</p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {editing.history.slice(-5).map((h) => (
                  <li key={h.at}>
                    {new Date(h.at).toLocaleDateString("en-GB")} → level {h.level}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              block
              loading={busy}
              onClick={async () => {
                if (editing && (await run(() => api.patch(`/api/learning/skills/${editing.id}`, { evidence })))) setEditing(null);
              }}
            >
              Save evidence
            </Button>
            {editing && !editing.is_default && (
              <Button
                variant="ghost"
                aria-label="Remove skill"
                onClick={async () => {
                  if (await run(() => api.delete(`/api/learning/skills/${editing.id}`))) setEditing(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

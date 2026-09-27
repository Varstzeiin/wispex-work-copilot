"use client";

import clsx from "clsx";
import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, PageHeader, Spinner, inputClass } from "@/components/ui";
import { Tabs } from "@/components/ui/Tabs";
import { useFeedback, useLearningItems, useRefreshPerformance, useSkills } from "@/features/performance/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { dateLocale, t } from "@/lib/i18n";
import { LEARNING_CATEGORY_LABEL, LEARNING_STATUS } from "@/lib/utils/labels";
import { formatDateTime } from "@/lib/utils/time";
import type { FeedbackItem, LearningItem, LearningStatus, SkillItem } from "@/types";

type Tab = "learning" | "feedback" | "skills";

export default function LearningPage() {
  const [tab, setTab] = useState<Tab>("learning");
  return (
    <div>
      <PageHeader
        title={t("Learning", "Belajar")}
        subtitle={t("Track what you learn, the feedback you apply, and your skills.", "Pantau apa yang kamu pelajari, feedback yang kamu terapkan, dan skill-mu.")}
      />
      <Tabs
        label={t("Learning view", "Tampilan belajar")}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "learning", label: t("Learning tracker", "Daftar belajar") },
          { key: "feedback", label: "Feedback" },
          { key: "skills", label: t("Skill matrix", "Matriks skill") },
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
          <Plus className="h-4 w-4" aria-hidden /> {t("Add", "Tambah")}
        </Button>
      </div>
      <InlineError message={actionError} />
      {data.length === 0 && (
        <EmptyState title={t("Nothing tracked yet", "Belum ada yang dipantau")}>
          {t("Add training topics, SOP references, terms or lessons learned.", "Tambahkan topik pelatihan, referensi SOP, istilah, atau pelajaran.")}
        </EmptyState>
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
                  {t("Mark as", "Tandai")} {LEARNING_STATUS[next].label.toLowerCase()} →
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
    <Modal
      open={open}
      title={item ? t("Edit learning item", "Ubah materi belajar") : t("Add learning item", "Tambah materi belajar")} onClose={() => { setLoadedFor(null); onClose(); }}>
      <div className="space-y-3">
        <Field label={t("Topic", "Topik")} htmlFor="l-title">
          <input id="l-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Gross vs net weight", "mis. Berat kotor vs berat bersih")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Category", "Kategori")} htmlFor="l-cat">
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
        <Field
          label={t("Source", "Sumber")}
          htmlFor="l-source"
          hint={t("Where did you learn it? e.g. Training week 1, SOP folder, senior", "Dari mana kamu mempelajarinya? mis. Pelatihan minggu 1, folder SOP, senior")}
        >
          <input id="l-source" className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Field
          label={t("Notes", "Catatan")}
          htmlFor="l-notes"
          hint={t("Your own words. Do not copy confidential SOP text.", "Pakai kata-katamu sendiri. Jangan menyalin teks SOP yang rahasia.")}
        >
          <textarea id="l-notes" rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <InlineError message={error} />
        <div className="flex gap-2">
          <Button block onClick={save} loading={busy} disabled={!title.trim()}>
            {t("Save", "Simpan")}
          </Button>
          {item && (
            <Button
              variant="ghost"
              aria-label={t("Delete learning item", "Hapus materi belajar")}
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
          {t(`${applied} of ${data.length} applied`, `${applied} dari ${data.length} diterapkan`)}
        </p>
        <Button onClick={() => setAdding(true)} disabled={!online}>
          <Plus className="h-4 w-4" aria-hidden /> {t("Record feedback", "Catat feedback")}
        </Button>
      </div>
      <InlineError message={actionError} />
      {data.length === 0 && (
        <EmptyState title={t("No feedback recorded", "Belum ada feedback tercatat")}>
          {t(
            "Record feedback with an action plan, then the evidence that you applied it.",
            "Catat feedback beserta rencana aksinya, lalu bukti bahwa kamu sudah menerapkannya.",
          )}
        </EmptyState>
      )}
      <ul className="space-y-2">
        {data.map((f) => (
          <li key={f.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-slate-500">
                {f.from_role || "Feedback"} · {formatDateTime(f.received_at, timezone)}
              </p>
              {f.applied ? (
                <Badge className="bg-emerald-100 text-emerald-800">
                  <Check className="h-3 w-3" aria-hidden /> {t("Applied", "Diterapkan")}
                </Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-900">{t("Open", "Terbuka")}</Badge>
              )}
            </div>
            <p className="mt-1 font-medium text-slate-900">{f.summary}</p>
            {f.action_plan && (
              <p className="mt-1 text-slate-600">
                {t("Plan", "Rencana")}: {f.action_plan}
              </p>
            )}
            {f.applied_evidence && (
              <p className="mt-1 text-emerald-800">
                {t("Evidence", "Bukti")}: {f.applied_evidence}
              </p>
            )}
            {!f.applied && (
              <button
                onClick={() => {
                  setApplying(f);
                  setEvidence("");
                }}
                disabled={!online}
                className="mt-2 text-xs font-semibold text-brand-700 disabled:text-slate-400"
              >
                {t("Mark as applied", "Tandai diterapkan")} →
              </button>
            )}
          </li>
        ))}
      </ul>

      <Modal open={adding} title={t("Record feedback", "Catat feedback")} onClose={() => setAdding(false)}>
        <div className="space-y-3">
          <Field label={t("From (role)", "Dari (peran)")} htmlFor="fb-role" hint={t("A role is enough. No names needed.", "Cukup perannya. Tidak perlu nama.")}>
            <input id="fb-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label={t("What was the feedback?", "Apa isi feedback-nya?")} htmlFor="fb-summary">
            <textarea id="fb-summary" rows={3} className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <Field label={t("How will you apply it?", "Bagaimana kamu akan menerapkannya?")} htmlFor="fb-plan">
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
            {t("Save", "Simpan")}
          </Button>
        </div>
      </Modal>

      <Modal open={applying !== null} title={t("Feedback applied", "Feedback diterapkan")} onClose={() => setApplying(null)}>
        <div className="space-y-3">
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{applying?.summary}</p>
          <Field
            label={t("Evidence that you applied it", "Bukti bahwa kamu menerapkannya")}
            htmlFor="fb-evidence"
            hint={t("e.g. Last 5 questions included the deadline", "mis. 5 pertanyaan terakhir sudah menyertakan deadline")}
          >
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
            {t("Mark as applied", "Tandai diterapkan")}
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
        {t(
          "Self-assessment with evidence. 0 Not yet · 1 Aware · 2 With guidance · 3 Independent · 4 Can teach others.",
          "Penilaian diri dengan bukti. 0 Belum · 1 Tahu · 2 Dengan bimbingan · 3 Mandiri · 4 Bisa mengajari orang lain.",
        )}
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
            <div className="mt-2 grid grid-cols-5 gap-1" role="radiogroup" aria-label={`Level ${s.name}`}>
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
            {s.evidence && (
              <p className="mt-2 text-xs text-slate-600">
                {t("Evidence", "Bukti")}: {s.evidence}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className={inputClass} placeholder={t("Add a skill", "Tambah skill")}
          value={newSkill}
          onChange={(e) => setNewSkill(e.target.value)}
          aria-label={t("New skill name", "Nama skill baru")} />
        <Button
          variant="secondary"
          disabled={!online || busy || !newSkill.trim()}
          onClick={async () => {
            if (await run(() => api.post("/api/learning/skills", { name: newSkill }))) setNewSkill("");
          }}
        >
          <Plus className="h-4 w-4" aria-hidden /> {t("Add", "Tambah")}
        </Button>
      </div>

      <Modal open={editing !== null} title={editing?.name ?? ""} onClose={() => setEditing(null)}>
        <div className="space-y-3">
          <Field
            label={t("Evidence for your current level", "Bukti untuk level kamu sekarang")}
            htmlFor="sk-evidence"
            hint={t("e.g. Processed 20 invoices without corrections", "mis. Memproses 20 invoice tanpa koreksi")}
          >
            <textarea id="sk-evidence" rows={3} className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          {editing && editing.history.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Level history", "Riwayat level")}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {editing.history.slice(-5).map((h) => (
                  <li key={h.at}>
                    {new Date(h.at).toLocaleDateString(dateLocale())} → level {h.level}
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
              {t("Save evidence", "Simpan bukti")}
            </Button>
            {editing && !editing.is_default && (
              <Button
                variant="ghost"
                aria-label={t("Remove skill", "Hapus skill")}
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

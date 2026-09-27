"use client";

import { CheckCircle2, Pause, Play, RotateCcw, ShieldAlert, Timer, XCircle, Eye } from "lucide-react";
import { useState } from "react";

import { Button, Field, InlineError, Modal, inputClass } from "@/components/ui";
import { useDocumentSettings } from "@/features/document-ai/hooks";
import { taskApi, useRefreshTaskData } from "@/features/task-management/hooks";
import { errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { STATUS_LABEL } from "@/lib/utils/labels";
import { t } from "@/lib/i18n";
import type { Task, TaskStatus } from "@/types";

interface Action {
  to: TaskStatus;
  label: string;
  icon: typeof Play;
  primary?: boolean;
  danger?: boolean;
}

function actionsFor(status: TaskStatus): Action[] {
  const start: Action = { to: "IN_PROGRESS", label: t("Start task", "Mulai task"), icon: Play, primary: true };
  const resume: Action = { to: "IN_PROGRESS", label: t("Resume", "Lanjutkan"), icon: Play, primary: true };
  const complete: Action = { to: "COMPLETED", label: t("Complete", "Selesaikan"), icon: CheckCircle2, primary: true };
  const review: Action = { to: "NEEDS_REVIEW", label: t("Needs review", "Perlu dicek"), icon: Eye };
  const waiting: Action = { to: "WAITING", label: t("Waiting", "Menunggu"), icon: Timer };
  const escalate: Action = { to: "ESCALATED", label: t("Escalate", "Eskalasi"), icon: ShieldAlert, danger: true };
  const hold: Action = { to: "ON_HOLD", label: t("Hold", "Tahan"), icon: Pause };
  switch (status) {
    case "NEW":
      return [start, waiting, escalate, hold];
    case "IN_PROGRESS":
      return [complete, review, waiting, escalate, hold];
    case "NEEDS_REVIEW":
      return [complete, { ...resume, label: t("Back to in progress", "Kembali dikerjakan"), primary: false }, waiting, escalate];
    case "WAITING":
      return [resume, escalate, hold];
    case "ESCALATED":
      return [{ ...resume, label: t("Resume (guidance received)", "Lanjutkan (arahan sudah diterima)") }, hold];
    case "ON_HOLD":
      return [resume];
    default:
      return [{ to: "IN_PROGRESS", label: t("Reopen", "Buka lagi"), icon: RotateCcw }];
  }
}

function notePrompt(status: TaskStatus): string {
  const prompts: Partial<Record<TaskStatus, string>> = {
    ESCALATED: t("Who did you escalate to, and what exactly is unresolved?", "Eskalasi ke siapa, dan apa persisnya yang belum selesai?"),
    WAITING: t("What are you waiting for, and from whom?", "Menunggu apa, dan dari siapa?"),
    ON_HOLD: t("Why is this on hold? Who asked for it?", "Kenapa ditahan? Siapa yang meminta?"),
    IN_PROGRESS: t("Optional note", "Catatan (opsional)"),
    NEEDS_REVIEW: t("What needs review?", "Apa yang perlu dicek?"),
    CANCELLED: t("Why is this task cancelled?", "Kenapa task ini dibatalkan?"),
  };
  return prompts[status] ?? t("Note", "Catatan");
}

export function StatusActions({ task }: { task: Task }) {
  const refresh = useRefreshTaskData();
  const online = useOnline();
  const [target, setTarget] = useState<TaskStatus | null>(null);
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const { data: docSettings } = useDocumentSettings();
  const checklist = docSettings?.final_checklist ?? [];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = actionsFor(task.status);
  const closed = task.status === "COMPLETED" || task.status === "CANCELLED";

  function open(to: TaskStatus) {
    setTarget(to);
    setNote("");
    setVerified(false);
    setTicked([]);
    setError(null);
  }

  async function quick(to: TaskStatus) {
    // Starting / resuming is safe to do in one tap
    setSaving(true);
    setError(null);
    try {
      await taskApi.changeStatus(task.id, to);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      await taskApi.changeStatus(task.id, target, note.trim(), verified, ticked);
      await refresh();
      setTarget(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const noteRequired = target === "ESCALATED" || target === "ON_HOLD" || target === "CANCELLED";
  const blockers = [
    ...(task.missing_documents.length ? [`${t("Missing", "Kurang")}: ${task.missing_documents.join(", ")}`] : []),
    ...(task.open_issue_count ? [`${task.open_issue_count} ${t("open issue(s)", "masalah terbuka")}`] : []),
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {actions.map((a) => {
          const Icon = a.icon;
          const oneTap = a.to === "IN_PROGRESS" && !closed;
          return (
            <Button
              key={a.label}
              variant={a.primary ? "primary" : a.danger ? "secondary" : "secondary"}
              size="lg"
              className={a.primary ? "col-span-2 sm:col-span-1" : a.danger ? "text-red-700" : ""}
              disabled={!online || saving}
              loading={saving && oneTap}
              onClick={() => (oneTap ? quick(a.to) : open(a.to))}
            >
              <Icon className="h-4 w-4" aria-hidden /> {a.label}
            </Button>
          );
        })}
        {!closed && (
          <Button variant="ghost" size="lg" disabled={!online} onClick={() => open("CANCELLED")}>
            <XCircle className="h-4 w-4" aria-hidden /> {t("Cancel task", "Batalkan task")}
          </Button>
        )}
      </div>
      {!target && <div className="mt-2"><InlineError message={error} /></div>}

      <Modal open={target !== null} title={target === "COMPLETED" ? t("Complete task", "Selesaikan task") : `${t("Mark as", "Tandai sebagai")} ${target ? STATUS_LABEL[target].toLowerCase() : ""}`} onClose={() => setTarget(null)}>
        <div className="space-y-3">
          {target === "COMPLETED" && (
            <>
              {blockers.length > 0 ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <p className="font-semibold">{t("This task cannot be completed yet", "Task ini belum bisa diselesaikan")}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs">
                    {t(
                      "Resolve them first, or record the instruction you received on the issue.",
                      "Selesaikan dulu, atau catat arahan yang kamu terima di masalah tersebut.",
                    )}
                  </p>
                </div>
              ) : (
                <>
                {checklist.length > 0 && (
                  <fieldset className="rounded-xl border border-slate-200 p-3">
                    <legend className="px-1 text-sm font-semibold text-slate-700">
                      {t("Final checklist", "Checklist akhir")} ({ticked.length}/{checklist.length})
                    </legend>
                    <ul className="space-y-1.5">
                      {checklist.map((item) => (
                        <li key={item}>
                          <label className="flex items-center gap-3 text-sm">
                            <input
                              type="checkbox"
                              className="h-5 w-5 accent-emerald-600"
                              checked={ticked.includes(item)}
                              onChange={(e) =>
                                setTicked(e.target.checked ? [...ticked, item] : ticked.filter((x) => x !== item))
                              }
                            />
                            {item}
                          </label>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-slate-500">
                      {t(
                        "Your personal checklist (Settings). It does not replace official SOP.",
                        "Checklist pribadi kamu (Pengaturan). Tidak menggantikan SOP resmi.",
                      )}
                    </p>
                  </fieldset>
                )}
                <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 accent-emerald-600"
                    checked={verified}
                    onChange={(e) => setVerified(e.target.checked)}
                  />
                  <span>
                    {t(
                      "I verified the documents and data for this task against the source documents. I am not submitting anything I am unsure about.",
                      "Aku sudah memverifikasi dokumen dan data task ini dengan dokumen sumber. Aku tidak mengirim apa pun yang masih ragu.",
                    )}
                  </span>
                </label>
                </>
              )}
            </>
          )}
          {target === "ESCALATED" && (
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              {t(
                "Before escalating: verify, check documentation and alternatives. Escalate when it is still unresolved, documents conflict, or the deadline is at risk. Follow the applicable SOP.",
                "Sebelum eskalasi: verifikasi, cek dokumentasi dan alternatif. Eskalasi kalau masih belum selesai, dokumen saling bertentangan, atau deadline berisiko. Ikuti SOP yang berlaku.",
              )}
            </p>
          )}
          {target !== "COMPLETED" && (
            <Field
              label={notePrompt(target ?? "IN_PROGRESS")}
              htmlFor="status-note"
              hint={t("Saved in the task notes with a timestamp.", "Disimpan di catatan task beserta waktunya.")}
            >
              <textarea id="status-note" rows={3} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          <InlineError message={error} />
          <Button
            block
            size="lg"
            loading={saving}
            variant={target === "CANCELLED" ? "danger" : "primary"}
            disabled={
              !online ||
              (target === "COMPLETED" && (blockers.length > 0 || !verified || ticked.length < checklist.length)) ||
              (noteRequired && !note.trim())
            }
            onClick={confirm}
          >
            {target === "COMPLETED" ? t("Mark as completed", "Tandai selesai") : t("Confirm", "Konfirmasi")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

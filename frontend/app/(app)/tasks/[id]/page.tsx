"use client";

import { ArrowLeft, CalendarClock, Crosshair, FileText, Mail, Pencil, Plane, ShieldQuestion, Ship, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ClarificationList } from "@/components/assistant/ClarificationList";
import { TaskDocuments } from "@/components/document/TaskDocuments";
import { CalendarReminder } from "@/components/task/CalendarReminder";
import { Countdown, GuidanceChip, PriorityBadge, StatusBadge } from "@/components/task/badges";
import { StatusActions } from "@/components/task/StatusActions";
import { DocumentChecklist, IssueList, PriorityBreakdown } from "@/components/task/TaskSections";
import { Button, Card, ErrorState, InlineError, LinkButton, Modal, SectionTitle, Spinner } from "@/components/ui";
import { taskApi, useRefreshTaskData, useTask } from "@/features/task-management/hooks";
import { errorMessage } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { GUIDANCE } from "@/lib/utils/labels";
import { formatDateTime, formatMinutes } from "@/lib/utils/time";
import { t } from "@/lib/i18n";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const online = useOnline();
  const refresh = useRefreshTaskData();
  const { timezone } = useSettings();
  const { data: task, error, mutate } = useTask(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!task) return <Spinner />;

  const closed = task.status === "COMPLETED" || task.status === "CANCELLED";
  const ModeIcon = task.transport_mode === "AIR" ? Plane : Ship;
  const g = GUIDANCE[task.guidance];
  const docsDone = task.required_documents.length - task.missing_documents.length;

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await taskApi.remove(task!.id);
      await refresh();
      router.replace("/tasks");
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-slate-600">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t("Back", "Kembali")}
        </button>
        <div className="flex gap-1">
          <LinkButton href={`/tasks/${task.id}/edit`} variant="ghost">
            <Pencil className="h-4 w-4" aria-hidden /> {t("Edit", "Ubah")}
          </LinkButton>
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={!online} aria-label={t("Delete task", "Hapus task")}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {/* Mobile-first task header: what, how urgent, what's missing, what to do */}
          <Card>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 text-2xl font-bold uppercase tracking-tight text-slate-900">
                  {task.transport_mode && <ModeIcon className="h-5 w-5 text-slate-400" aria-hidden />}
                  {task.shipment_reference ?? task.title}
                </h1>
                <p className="text-sm text-slate-500">{[task.client_name, task.title].filter(Boolean).join(" · ")}</p>
              </div>
              <PriorityBadge level={task.priority_level} score={task.priority_score} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={task.status} />
              {task.client_sla_tier === "HIGH" && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">{t("High priority client", "Klien prioritas tinggi")}</span>
              )}
            </div>

            {!closed && (
              <div className="mt-3">
                <Countdown deadline={task.submission_deadline} info={task.deadline} size="lg" />
              </div>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase text-slate-500">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Deadline
                </dt>
                <dd className="font-semibold text-slate-900">{formatDateTime(task.submission_deadline, timezone)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase text-slate-500">
                  <ModeIcon className="h-3.5 w-3.5" aria-hidden /> ETA
                </dt>
                <dd className="font-semibold text-slate-900">{formatDateTime(task.eta, timezone)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase text-slate-500">
                  <FileText className="h-3.5 w-3.5" aria-hidden /> {t("Documents", "Dokumen")}
                </dt>
                <dd className={task.missing_documents.length ? "font-semibold text-orange-700" : "font-semibold text-slate-900"}>
                  {docsDone} / {task.required_documents.length}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase text-slate-500">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {t("Issues", "Masalah")}
                </dt>
                <dd className={task.open_issue_count ? "font-semibold text-amber-700" : "font-semibold text-slate-900"}>
                  {task.open_issue_count ? `${task.open_issue_count} ${t("open", "terbuka")}` : t("None", "Tidak ada")}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">{t("Estimated", "Estimasi")}</dt>
                <dd className="font-semibold text-slate-900">
                  {formatMinutes(task.estimated_minutes)}
                  {task.actual_minutes !== null && <span className="font-normal text-slate-500"> · {t("actual", "aktual")} {formatMinutes(task.actual_minutes)}</span>}
                </dd>
              </div>
              {task.assigned_action && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase text-slate-500">{t("Next action", "Aksi berikutnya")}</dt>
                  <dd className="font-medium text-slate-900">{task.assigned_action}</dd>
                </div>
              )}
            </dl>
          </Card>

          {!closed && (
            <section className={`rounded-2xl border p-4 ${g.style}`}>
              <div className="flex items-center gap-2">
                <GuidanceChip guidance={task.guidance} />
                <span className="text-xs font-semibold uppercase tracking-wide">{t("Suggested posture", "Sikap yang disarankan")}</span>
              </div>
              <p className="mt-2 text-sm">{task.guidance_reason}</p>
              <p className="mt-1 text-xs opacity-80">
                {t("Guidance only. You decide, following the applicable SOP.", "Hanya panduan. Kamu yang memutuskan, sesuai SOP yang berlaku.")}
              </p>
            </section>
          )}

          <Card>
            <SectionTitle>{t("Actions", "Aksi")}</SectionTitle>
            <StatusActions task={task} />
            {!closed && (
              <LinkButton href={`/focus?task=${task.id}`} block className="mt-2">
                <Crosshair className="h-4 w-4" aria-hidden /> {t("Open in Focus mode", "Buka di Mode fokus")}
              </LinkButton>
            )}
            {!closed && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <LinkButton href={`/assistant/unsure?task=${task.id}`}>
                  <ShieldQuestion className="h-4 w-4" aria-hidden /> {t("I'm not sure", "Aku tidak yakin")}
                </LinkButton>
                <LinkButton href={`/assistant/drafts?task=${task.id}`}>
                  <Mail className="h-4 w-4" aria-hidden /> {t("Draft message", "Draf pesan")}
                </LinkButton>
              </div>
            )}
            <div className="mt-3">
              <ClarificationList taskId={task.id} compact />
            </div>
          </Card>

          <DocumentChecklist task={task} disabled={closed} />
          <TaskDocuments task={task} />
          <IssueList task={task} disabled={closed} />
        </div>

        <div className="space-y-4">
          {!closed && <PriorityBreakdown task={task} />}
          {!closed && <CalendarReminder task={task} />}
          <Card>
            <SectionTitle>{t("Notes", "Catatan")}</SectionTitle>
            {task.notes ? (
              <p className="whitespace-pre-wrap text-sm text-slate-700">{task.notes}</p>
            ) : (
              <p className="text-sm text-slate-500">{t("No notes yet.", "Belum ada catatan.")}</p>
            )}
            <p className="mt-3 text-xs text-slate-400">
              {t("Created", "Dibuat")} {formatDateTime(task.created_at, timezone)}
              {task.completed_at && ` · ${t("Completed", "Selesai")} ${formatDateTime(task.completed_at, timezone)}`}
            </p>
            <Link href="/activity" className="mt-1 inline-block text-xs font-semibold text-brand-700">
              {t("View activity log", "Lihat log aktivitas")}
            </Link>
          </Card>
          <Card>
            <SectionTitle>{t("Found a mistake in submitted work?", "Menemukan kesalahan di pekerjaan yang sudah dikirim?")}</SectionTitle>
            <p className="text-sm text-slate-600">
              {t(
                "Report it as soon as you confirm it. The workflow guides you step by step.",
                "Laporkan begitu kamu yakin. Alurnya akan memandu kamu langkah demi langkah.",
              )}
            </p>
            <LinkButton href={`/errors/new?task=${task.id}`} className="mt-2">
              {t("Report an error", "Laporkan kesalahan")}
            </LinkButton>
          </Card>
        </div>
      </div>

      <Modal open={confirmDelete} title={t("Delete this task?", "Hapus task ini?")} onClose={() => setConfirmDelete(false)}>
        <p className="text-sm text-slate-600">
          {t(
            "This permanently deletes the task and its linked calendar event. The deletion is recorded in your activity log. To keep a record, mark it as cancelled instead.",
            "Ini menghapus task beserta event kalender yang terhubung secara permanen. Penghapusan dicatat di log aktivitas. Kalau ingin tetap ada catatannya, tandai sebagai dibatalkan saja.",
          )}
        </p>
        <div className="mt-3">
          <InlineError message={deleteError} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            {t("Keep task", "Simpan task")}
          </Button>
          <Button variant="danger" loading={deleting} onClick={remove}>
            {t("Delete", "Hapus")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

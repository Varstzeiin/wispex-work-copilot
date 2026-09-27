"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, InlineError, Modal } from "@/components/ui";
import { useDeleteTask } from "@/features/task-management/hooks";
import { errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { t } from "@/lib/i18n";

/** "Delete task" with a confirmation. Removes the task from the database and from cached lists. */
export function DeleteTaskButton({ taskId, block = false }: { taskId: string; block?: boolean }) {
  const router = useRouter();
  const online = useOnline();
  const deleteTask = useDeleteTask();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await deleteTask(taskId);
      router.replace("/tasks");
    } catch (e) {
      setError(errorMessage(e));
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!online}
        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400 ${block ? "w-full" : ""}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden /> {t("Delete task", "Hapus task")}
      </button>
      <Modal open={open} title={t("Delete this task?", "Hapus task ini?")} onClose={() => setOpen(false)}>
        <p className="text-sm text-slate-600">
          {t(
            "This permanently deletes the task and its calendar reminder. Use it for a task that was added by mistake. The deletion is recorded in your activity log. To keep a record, mark it as cancelled instead.",
            "Ini menghapus task beserta pengingat kalendernya secara permanen. Pakai ini untuk task yang salah ditambahkan. Penghapusan dicatat di log aktivitas. Kalau ingin tetap ada catatannya, tandai sebagai dibatalkan saja.",
          )}
        </p>
        <div className="mt-3">
          <InlineError message={error} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t("Keep task", "Jangan hapus")}
          </Button>
          <Button variant="danger" loading={deleting} onClick={confirm}>
            {t("Delete", "Hapus")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

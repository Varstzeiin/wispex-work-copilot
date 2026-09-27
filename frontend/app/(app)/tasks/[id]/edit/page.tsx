"use client";

import { useParams, useRouter } from "next/navigation";

import { TaskForm } from "@/components/forms/TaskForm";
import { ErrorState, PageHeader, Spinner } from "@/components/ui";
import { taskApi, useRefreshTaskData, useTask } from "@/features/task-management/hooks";
import { errorMessage } from "@/lib/api/client";
import { useSettings } from "@/lib/hooks";
import { t } from "@/lib/i18n";

export default function EditTaskPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const refresh = useRefreshTaskData();
  const { data: settings, timezone } = useSettings();
  // The form keeps its own state, so background refreshes never overwrite what is being typed
  const { data: task, error } = useTask(id);

  if (error) return <ErrorState message={errorMessage(error)} />;
  if (!task || !settings) return <Spinner />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`${t("Edit", "Ubah")} ${task.shipment_reference ?? task.title}`} />
      <TaskForm
        initial={task}
        timeZone={timezone}
        submitLabel={t("Save changes", "Simpan perubahan")}
        onCancel={() => router.back()}
        onSubmit={async (payload) => {
          await taskApi.update(task.id, payload);
          await refresh();
          router.replace(`/tasks/${task.id}`);
        }}
      />
    </div>
  );
}

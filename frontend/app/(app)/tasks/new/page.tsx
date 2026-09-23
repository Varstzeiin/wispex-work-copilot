"use client";

import { useRouter } from "next/navigation";

import { TaskForm } from "@/components/forms/TaskForm";
import { PageHeader, Spinner } from "@/components/ui";
import { taskApi, useRefreshTaskData } from "@/features/task-management/hooks";
import { useSettings } from "@/lib/hooks";

export default function NewTaskPage() {
  const router = useRouter();
  const refresh = useRefreshTaskData();
  const { data: settings, timezone } = useSettings();

  if (!settings) return <Spinner />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New task" subtitle="Priority is calculated automatically from your settings." />
      <TaskForm
        timeZone={timezone}
        submitLabel="Create task"
        onCancel={() => router.back()}
        onSubmit={async (payload) => {
          const task = await taskApi.create(payload);
          await refresh();
          router.replace(`/tasks/${task.id}`);
        }}
      />
    </div>
  );
}

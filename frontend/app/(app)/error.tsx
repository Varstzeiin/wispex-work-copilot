"use client";

import { ErrorState } from "@/components/ui";

// Never show raw errors. Technical details stay in the browser console / server logs.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <ErrorState message="Something went wrong while showing this page. Nothing was marked as completed." onRetry={reset} />
    </div>
  );
}

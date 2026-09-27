"use client";

import { ErrorState } from "@/components/ui";
import { t } from "@/lib/i18n";

// Never show raw errors. Technical details stay in the browser console / server logs.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <ErrorState
        message={t(
          "Something went wrong while showing this page. Nothing was marked as completed.",
          "Terjadi kesalahan saat menampilkan halaman ini. Tidak ada yang ditandai selesai.",
        )}
        onRetry={reset}
      />
    </div>
  );
}

"use client";

import { FlaskConical, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { BottomNav, Sidebar } from "@/components/navigation/nav";
import { NotificationCenter } from "@/components/navigation/NotificationCenter";
import { Spinner } from "@/components/ui";
import { NowProvider, useMe, useOnline } from "@/lib/hooks";
import { t } from "@/lib/i18n";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: user, error } = useMe();
  const online = useOnline();

  useEffect(() => {
    if (error && "status" in error && error.status === 401) router.replace("/login");
  }, [error, router]);

  if (!user) {
    return <div className="min-h-screen">{error && error.status !== 401 ? <OfflineOrError /> : <Spinner />}</div>;
  }

  return (
    <NowProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="min-w-0 flex-1">
          {!online && (
            <div className="sticky top-0 z-30 flex items-center gap-2 bg-slate-800 px-4 py-2 text-sm text-white" role="status">
              <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                <strong>{t("OFFLINE MODE.", "MODE OFFLINE.")}</strong>{" "}
                {t(
                  "Your connection is unavailable. Actions that change data are paused until it returns.",
                  "Koneksi sedang tidak tersedia. Aksi yang mengubah data ditunda sampai koneksi kembali.",
                )}
              </span>
            </div>
          )}
          {user.is_demo && (
            <div className="flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-4 py-1.5 text-xs text-violet-900">
              <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                <strong>{t("DEMO DATA.", "DATA DEMO.")}</strong>{" "}
                {t(
                  "All clients, shipments and values are fictional. This demo account is deleted after 24 hours.",
                  "Semua klien, shipment, dan nilai adalah fiktif. Akun demo ini dihapus setelah 24 jam.",
                )}
              </span>
            </div>
          )}
          <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">{children}</main>
        </div>
      </div>
      <BottomNav />
      <NotificationCenter />
    </NowProvider>
  );
}

function OfflineOrError() {
  return (
    <div className="mx-auto max-w-sm px-4 py-20 text-center text-sm text-slate-600">
      <p className="font-semibold text-slate-900">{t("Cannot load your workspace", "Workspace tidak bisa dimuat")}</p>
      <p className="mt-1">
        {t(
          "Check your connection. Nothing has been changed or marked as completed.",
          "Cek koneksi kamu. Tidak ada data yang diubah atau ditandai selesai.",
        )}
      </p>
      <button onClick={() => location.reload()} className="mt-3 font-semibold text-brand-700 underline">
        {t("Try again", "Coba lagi")}
      </button>
    </div>
  );
}

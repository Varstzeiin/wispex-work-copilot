"use client";

import { FlaskConical, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { BottomNav, Sidebar } from "@/components/navigation/nav";
import { NotificationCenter } from "@/components/navigation/NotificationCenter";
import { Spinner } from "@/components/ui";
import { NowProvider, useMe, useOnline } from "@/lib/hooks";

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
                <strong>OFFLINE MODE.</strong> Your connection is unavailable. Actions that change data are paused until
                it returns.
              </span>
            </div>
          )}
          {user.is_demo && (
            <div className="flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-4 py-1.5 text-xs text-violet-900">
              <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                <strong>DEMO DATA.</strong> All clients, shipments and values are fictional. This demo account is deleted
                after 24 hours.
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
      <p className="font-semibold text-slate-900">Cannot load your workspace</p>
      <p className="mt-1">Check your connection. Nothing has been changed or marked as completed.</p>
      <button onClick={() => location.reload()} className="mt-3 font-semibold text-brand-700 underline">
        Try again
      </button>
    </div>
  );
}

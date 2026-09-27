"use client";

import Link from "next/link";
import { t } from "@/lib/i18n";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-sm px-4 py-24 text-center">
      <h1 className="text-xl font-bold text-slate-900">{t("Page not found", "Halaman tidak ditemukan")}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {t(
          "The page or task does not exist, or you do not have access to it.",
          "Halaman atau task tidak ada, atau kamu tidak punya akses.",
        )}
      </p>
      <Link href="/" className="mt-4 inline-block font-semibold text-brand-700">
        {t("Back to home", "Kembali ke beranda")}
      </Link>
    </main>
  );
}

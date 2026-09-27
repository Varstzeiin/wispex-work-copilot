import { Bot, ShieldAlert } from "lucide-react";
import Link from "next/link";

import type { DocumentStatus } from "@/types";
import { t } from "@/lib/i18n";

/** Always visible where documents are uploaded (spec section 30). */
export function PrivacyNotice({ status }: { status?: DocumentStatus }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          {status?.ai_allowed
            ? t(
                "Do not upload confidential company or client documents unless your organization's policy explicitly permits this application and its AI provider to process them.",
                "Jangan mengunggah dokumen rahasia perusahaan atau klien, kecuali kebijakan organisasi kamu secara tegas mengizinkan aplikasi ini dan penyedia AI-nya memprosesnya.",
              )
            : t(
                "Do not upload confidential company or client documents unless your organization's policy explicitly permits this application to process them.",
                "Jangan mengunggah dokumen rahasia perusahaan atau klien, kecuali kebijakan organisasi kamu secara tegas mengizinkan aplikasi ini memprosesnya.",
              )}
        </p>
      </div>
      {status && (
        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <p>
            {status.is_demo
              ? t(
                  "Demo account: uploads are never sent to an AI provider. Fields are entered by hand.",
                  "Akun demo: unggahan tidak pernah dikirim ke penyedia AI. Field diisi manual.",
                )
              : !status.ai_configured
                ? t(
                    "Document AI is not configured on this server. Uploads are stored and fields are entered by hand.",
                    "AI dokumen belum diatur di server ini. Unggahan disimpan dan field diisi manual.",
                  )
                : status.ai_allowed
                  ? t(
                      `AI reading is on (${status.ai_provider === "anthropic" ? `Claude, ${status.ai_model}` : status.ai_provider}). Every value still needs your review before use.`,
                      `Pembacaan AI aktif (${status.ai_provider === "anthropic" ? `Claude, ${status.ai_model}` : status.ai_provider}). Setiap nilai tetap perlu kamu cek sebelum dipakai.`,
                    )
                  : t(
                      "AI reading is off for your account. Uploads are stored and fields are entered by hand.",
                      "Pembacaan AI mati untuk akunmu. Unggahan disimpan dan field diisi manual.",
                    )}{" "}
            {!status.is_demo && status.ai_configured && (
              <Link href="/settings#documents" className="font-semibold text-brand-700 underline">
                {t("Document settings", "Pengaturan dokumen")}
              </Link>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

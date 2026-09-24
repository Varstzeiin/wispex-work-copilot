import { Bot, ShieldAlert } from "lucide-react";
import Link from "next/link";

import type { DocumentStatus } from "@/types";

/** Always visible where documents are uploaded (spec section 30). */
export function PrivacyNotice({ status }: { status?: DocumentStatus }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Do not upload confidential company or client documents unless your organization&apos;s policy explicitly permits this
          application{status?.ai_allowed ? " and its AI provider" : ""} to process them.
        </p>
      </div>
      {status && (
        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <p>
            {status.is_demo
              ? "Demo account: uploads are never sent to an AI provider. Fields are entered by hand."
              : !status.ai_configured
                ? "Document AI is not configured on this server. Uploads are stored and fields are entered by hand."
                : status.ai_allowed
                  ? `AI reading is on (${status.ai_provider === "anthropic" ? `Claude, ${status.ai_model}` : status.ai_provider}). Every value still needs your review before use.`
                  : "AI reading is off for your account. Uploads are stored and fields are entered by hand."}{" "}
            {!status.is_demo && status.ai_configured && (
              <Link href="/settings#documents" className="font-semibold text-brand-700 underline">
                Document settings
              </Link>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import clsx from "clsx";
import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSWRConfig } from "swr";

import { Button, Field, InlineError, inputClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import type { User } from "@/types";

export default function LoginPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);

  async function enter(promise: Promise<User>, kind: "form" | "demo") {
    setBusy(kind);
    setError(null);
    try {
      const user = await promise;
      // Clear any cached data from a previous session before entering
      await mutate(() => true, undefined, { revalidate: false });
      await mutate("/api/auth/me", user, { revalidate: false });
      router.replace("/");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "signin") enter(api.post<User>("/api/auth/login", { email, password }), "form");
    else enter(api.post<User>("/api/auth/register", { email, password, full_name: fullName }), "form");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="mx-auto h-16 w-16 rounded-2xl" />
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Wispex Work Copilot</h1>
          <p className="mt-1 text-sm text-slate-500">Accuracy → Reliability → Independence → Trust</p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
            {(["signin", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={clsx("rounded-lg py-2", mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "register" && (
              <Field label="Name" htmlFor="name">
                <input id="name" className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
              </Field>
            )}
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                type="email"
                required
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </Field>
            <Field label="Password" htmlFor="password" hint={mode === "register" ? "At least 10 characters." : undefined}>
              <input
                id="password"
                type="password"
                required
                minLength={mode === "register" ? 10 : 1}
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </Field>
            <InlineError message={error} />
            <Button type="submit" block size="lg" loading={busy === "form"} disabled={busy !== null}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="mt-3 text-center text-xs text-slate-400">Google sign-in: Coming Later</p>

          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
          </div>
          <Button
            variant="secondary"
            block
            size="lg"
            loading={busy === "demo"}
            disabled={busy !== null}
            onClick={() => enter(api.post<User>("/api/demo/start"), "demo")}
          >
            Try the demo (fictional data)
          </Button>
        </div>

        <div className="mt-4 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
          <p>
            Do not upload or enter confidential company or client information unless your organization&apos;s policy explicitly
            permits this application to process it.
          </p>
        </div>
      </div>
    </main>
  );
}

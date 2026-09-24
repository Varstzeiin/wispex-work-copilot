"use client";

import clsx from "clsx";
import { ShieldAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Button, Field, InlineError, inputClass } from "@/components/ui";
import { api, errorMessage, fetcher } from "@/lib/api/client";
import type { User } from "@/types";

const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  expired: "The Google sign-in took too long or was started elsewhere. Please try again.",
  failed: "Google sign-in did not succeed. Please try again.",
  email_exists: "An account with this email already exists. Sign in with your email and password.",
  unavailable: "Google sign-in is not set up on this server yet.",
};

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  // Which sign-in methods the server offers. An error here usually means the backend is unreachable.
  const { data: providers, error: providersError } = useSWR<{ google: boolean }>("/api/auth/providers", fetcher, {
    shouldRetryOnError: false,
  });
  const { mutate } = useSWRConfig();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(GOOGLE_ERRORS[params.get("google") ?? ""] ?? null);
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

          {providersError && (
            <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              The server is not reachable right now, so signing in will not work. Please try again later.
            </p>
          )}
          {providers?.google && (
            <>
              <a
                href="/api/auth/google/start"
                className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 font-semibold text-slate-800 hover:bg-slate-50"
              >
                <GoogleIcon /> Continue with Google
              </a>
              <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" /> or with email <span className="h-px flex-1 bg-slate-200" />
              </div>
            </>
          )}

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

          {providers && !providers.google && (
            <p className="mt-3 text-center text-xs text-slate-400">Google sign-in: Integration Required (not set up on this server)</p>
          )}

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

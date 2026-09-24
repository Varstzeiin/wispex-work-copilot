"use client";

import { Mail, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";

import { CopyButton } from "@/components/assistant/CopyButton";
import { RewriteButton } from "@/components/assistant/RewriteButton";
import { Badge, Button, Card, EmptyState, Field, InlineError, PageHeader, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { useDrafts, useRefreshAssistant } from "@/features/assistant/hooks";
import { useTasks } from "@/features/task-management/hooks";
import { api, errorMessage, fetcher } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { DRAFT_KIND_LABEL } from "@/lib/utils/labels";
import { formatDateTime } from "@/lib/utils/time";
import type { CommunicationDraft, DraftKind, GeneratedDraft } from "@/types";

const KINDS = Object.keys(DRAFT_KIND_LABEL) as DraftKind[];

export default function DraftsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Drafts />
    </Suspense>
  );
}

function Drafts() {
  const params = useSearchParams();
  const online = useOnline();
  const refresh = useRefreshAssistant();
  const { data: tasks } = useTasks({ view: "open", sort: "deadline", pageSize: 100 });

  const [kind, setKind] = useState<DraftKind>((params.get("kind") as DraftKind) || "CLARIFICATION");
  const [taskId, setTaskId] = useState(params.get("task") ?? "");
  const [errorId, setErrorId] = useState(params.get("error") ?? "");
  const [greeting, setGreeting] = useState("Hi");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Error reports are only needed for a correction notification
  const { data: errors } = useSWR<{ items: { id: string; field_name: string; shipment_reference: string; status: string }[] }>(
    kind === "CORRECTION" ? "/api/errors?page_size=50" : null,
    fetcher,
  );

  async function generate() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setDraft(
        await api.post<GeneratedDraft>("/api/assistant/drafts/generate", {
          kind,
          task_id: taskId || null,
          error_id: errorId || null,
          discrepancy_id: params.get("discrepancy") || null,
          greeting,
          note,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/assistant/drafts", {
        kind: draft.kind,
        task_id: draft.task_id,
        recipient,
        subject: draft.subject,
        body: draft.body,
      });
      await refresh();
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const needsNote = kind === "CLARIFICATION" || kind === "ESCALATION" || kind === "STATUS_UPDATE" || kind === "CORRECTION";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Draft a message" subtitle="Built from your task data. You review, copy and send it yourself." />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Message type" htmlFor="kind">
            <select id="kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {DRAFT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          {kind === "CORRECTION" ? (
            <Field label="Error report" htmlFor="error">
              <select id="error" className={inputClass} value={errorId} onChange={(e) => setErrorId(e.target.value)}>
                <option value="">Choose an error report</option>
                {errors?.items.map((e) => (
                  <option key={e.id} value={e.id}>
                    {[e.shipment_reference, e.field_name].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Task" htmlFor="task">
              <select id="task" className={inputClass} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">Choose a task</option>
                {tasks?.items.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.shipment_reference ?? t.title} · {t.deadline.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Greeting" htmlFor="greeting">
            <input id="greeting" className={inputClass} value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Recipient (for your records)" htmlFor="recipient">
            <input id="recipient" className={inputClass} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="e.g. Forwarder contact" maxLength={120} />
          </Field>
        </div>
        {needsNote && (
          <div className="mt-3">
            <Field
              label={kind === "STATUS_UPDATE" ? "Next step (optional)" : kind === "CORRECTION" ? "Extra note (optional)" : "What do you need?"}
              htmlFor="note"
            >
              <textarea id="note" rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </Field>
          </div>
        )}
        <div className="mt-3">
          <InlineError message={error} />
        </div>
        <Button className="mt-3" block size="lg" onClick={generate} loading={busy && !draft} disabled={!online}>
          <Mail className="h-5 w-5" aria-hidden /> Generate draft
        </Button>
      </Card>

      {draft && (
        <Card>
          <SectionTitle>Draft</SectionTitle>
          <Field label="Subject" htmlFor="subject">
            <input id="subject" className={inputClass} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={200} />
          </Field>
          <div className="mt-3">
            <Field label="Message" htmlFor="body" hint="Context → Issue → Evidence → Deadline → Requested action.">
              <textarea id="body" rows={12} className={inputClass} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} maxLength={5000} />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <CopyButton text={draft.body} label="Copy message" />
            <Button variant="secondary" onClick={save} loading={busy} disabled={!online || saved}>
              {saved ? "Saved" : "Save draft"}
            </Button>
            <RewriteButton text={draft.body} onRewrite={(body) => setDraft({ ...draft, body })} />
          </div>
          <p className="mt-3 text-xs text-slate-500">This application never sends messages. Send it yourself through your approved work channel.</p>
        </Card>
      )}

      <SavedDrafts />
    </div>
  );
}

function SavedDrafts() {
  const online = useOnline();
  const { timezone } = useSettings();
  const refresh = useRefreshAssistant();
  const { data } = useDrafts();
  const [error, setError] = useState<string | null>(null);

  async function act(d: CommunicationDraft, action: "sent" | "delete") {
    setError(null);
    try {
      if (action === "sent") await api.post(`/api/assistant/drafts/${d.id}/sent`);
      else await api.delete(`/api/assistant/drafts/${d.id}`);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!data) return null;
  return (
    <section>
      <SectionTitle>Saved drafts</SectionTitle>
      <InlineError message={error} />
      {data.items.length === 0 ? (
        <EmptyState title="No saved drafts" />
      ) : (
        <ul className="space-y-2">
          {data.items.map((d) => (
            <li key={d.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
              <details>
                <summary className="flex cursor-pointer list-none items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-900">{d.subject || d.kind_label}</span>
                    <span className="text-xs text-slate-500">
                      {d.recipient && `${d.recipient} · `}
                      {formatDateTime(d.created_at, timezone)}
                    </span>
                  </span>
                  <Badge className={d.status === "SENT_MANUALLY" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}>
                    {d.status === "SENT_MANUALLY" ? "Sent by you" : "Draft"}
                  </Badge>
                </summary>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-slate-800">{d.body}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyButton text={d.body} />
                  {d.status === "DRAFT" && (
                    <Button variant="secondary" onClick={() => act(d, "sent")} disabled={!online}>
                      <Send className="h-4 w-4" aria-hidden /> I sent it myself
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => act(d, "delete")} disabled={!online} aria-label="Delete draft">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                  {d.task_id && (
                    <Link href={`/tasks/${d.task_id}`} className="self-center text-xs font-semibold text-brand-700">
                      {d.shipment_reference || "Open task"}
                    </Link>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

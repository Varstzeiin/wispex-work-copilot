"use client";

import { AtSign, Mail, Send, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";

import { CopyButton } from "@/components/assistant/CopyButton";
import { RewriteButton } from "@/components/assistant/RewriteButton";
import { Badge, Button, Card, EmptyState, Field, InlineError, Modal, PageHeader, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { useDrafts, useRefreshAssistant } from "@/features/assistant/hooks";
import { useAutomationStatus } from "@/features/automation/hooks";
import { useTasks } from "@/features/task-management/hooks";
import { api, errorMessage, fetcher } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { DRAFT_KIND_LABEL, DRAFT_STATUS } from "@/lib/utils/labels";
import { formatDateTime } from "@/lib/utils/time";
import { t } from "@/lib/i18n";
import type { CommunicationDraft, DraftKind, GeneratedDraft } from "@/types";

const KINDS = Object.keys(DRAFT_KIND_LABEL) as DraftKind[];

type EscalationReason = "DISCREPANCY" | "MISSING_DOCUMENTS" | "UNREADABLE" | "DEADLINE" | "OTHER";

function escalationReasons(): { key: EscalationReason; label: string }[] {
  return [
    { key: "DISCREPANCY", label: t("Differences between documents", "Perbedaan antar dokumen") },
    { key: "MISSING_DOCUMENTS", label: t("Missing documents", "Dokumen kurang") },
    { key: "UNREADABLE", label: t("Values that are hard to read", "Nilai yang sulit dibaca") },
    { key: "DEADLINE", label: t("Deadline at risk", "Deadline berisiko") },
    { key: "OTHER", label: t("Something else (describe it)", "Hal lain (jelaskan)") },
  ];
}

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
  // The message itself is always in English, whatever the app language
  const [greeting, setGreeting] = useState("Hi");
  const [reason, setReason] = useState<EscalationReason>("DISCREPANCY");
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
          reason: kind === "ESCALATION" ? reason : "",
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
      <PageHeader
        title={t("Draft a message", "Buat draf pesan")}
        subtitle={t("Built from your task data. You review, copy and send it yourself.", "Dibuat dari data task kamu. Kamu cek, salin, lalu kirim sendiri.")}
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Message type", "Jenis pesan")} htmlFor="kind">
            <select id="kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {DRAFT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          {kind === "CORRECTION" ? (
            <Field label={t("Error report", "Laporan kesalahan")} htmlFor="error">
              <select id="error" className={inputClass} value={errorId} onChange={(e) => setErrorId(e.target.value)}>
                <option value="">{t("Choose an error report", "Pilih laporan kesalahan")}</option>
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
                <option value="">{t("Choose a task", "Pilih task")}</option>
                {tasks?.items.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.shipment_reference ?? task.title} · {task.deadline.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("Greeting", "Sapaan")} htmlFor="greeting">
            <input id="greeting" className={inputClass} value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={60} />
          </Field>
          <Field label={t("Recipient (for your records)", "Penerima (untuk catatanmu)")} htmlFor="recipient">
            <input id="recipient" className={inputClass} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={t("e.g. Forwarder contact", "mis. Kontak forwarder")} maxLength={120} />
          </Field>
        </div>
        {kind === "ESCALATION" && (
          <div className="mt-3">
            <Field
              label={t("What are you escalating?", "Apa yang dieskalasi?")}
              htmlFor="reason"
              hint={t(
                "The message covers only this, using the facts recorded on the task.",
                "Pesan hanya membahas ini, memakai fakta yang tercatat di task.",
              )}
            >
              <select id="reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as EscalationReason)}>
                {escalationReasons().map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        {needsNote && (
          <div className="mt-3">
            <Field
              label={
                kind === "STATUS_UPDATE"
                  ? t("Next step (optional)", "Langkah berikutnya (opsional)")
                  : kind === "CORRECTION" || (kind === "ESCALATION" && reason !== "OTHER")
                    ? t("Extra detail (optional)", "Detail tambahan (opsional)")
                    : t("What do you need?", "Apa yang kamu butuhkan?")
              }
              htmlFor="note"
              hint={t(
                "Write it in English: it goes into the message exactly as written.",
                "Tulis dalam bahasa Inggris: teks ini masuk ke pesan persis seperti yang kamu tulis.",
              )}
            >
              <textarea id="note" rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </Field>
          </div>
        )}
        <div className="mt-3">
          <InlineError message={error} />
        </div>
        <Button className="mt-3" block size="lg" onClick={generate} loading={busy && !draft} disabled={!online}>
          <Mail className="h-5 w-5" aria-hidden /> {t("Generate draft", "Buat draf")}
        </Button>
      </Card>

      {draft && (
        <Card>
          <SectionTitle>{t("Draft", "Draf")}</SectionTitle>
          <Field label={t("Subject", "Subjek")} htmlFor="subject">
            <input id="subject" className={inputClass} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={200} />
          </Field>
          <div className="mt-3">
            <Field
              label={t("Message", "Pesan")}
              htmlFor="body"
              hint={t("Context → Issue → Evidence → Deadline → Requested action.", "Konteks → Masalah → Bukti → Deadline → Aksi yang diminta.")}
            >
              <textarea id="body" rows={12} className={inputClass} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} maxLength={5000} />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <CopyButton text={draft.body} label={t("Copy message", "Salin pesan")} />
            <Button variant="secondary" onClick={save} loading={busy} disabled={!online || saved}>
              {saved ? t("Saved", "Tersimpan") : t("Save draft", "Simpan draf")}
            </Button>
            <RewriteButton text={draft.body} onRewrite={(body) => setDraft({ ...draft, body })} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {t(
              "Nothing is sent from here. Copy it and send it yourself, or save it and, if your organization allows it, send it from the saved drafts after reviewing and approving it.",
              "Tidak ada yang dikirim dari sini. Salin lalu kirim sendiri, atau simpan dan, kalau organisasi kamu mengizinkan, kirim dari draf tersimpan setelah kamu cek dan setujui.",
            )}
          </p>
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
  const { data: channels } = useAutomationStatus();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<{ draft: CommunicationDraft; via: "email" | "team" } | null>(null);

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
  const canEmail = !!channels?.email_configured && !!channels.email_allowed;
  const canTeam = !!channels?.team_configured && !!channels.team_allowed;
  return (
    <section>
      <SectionTitle>{t("Saved drafts", "Draf tersimpan")}</SectionTitle>
      <InlineError message={error} />
      {channels && !canEmail && !canTeam && (
        <p className="mb-2 text-xs text-slate-500">
          {t("Sending from the app", "Pengiriman dari aplikasi")}:{" "}
          {channels.email_configured || channels.team_configured ? t("off (see Settings)", "mati (lihat Pengaturan)") : "Integration Required"}.{" "}
          {t("Copy the text and send it yourself.", "Salin teksnya lalu kirim sendiri.")}
        </p>
      )}
      {data.items.length === 0 ? (
        <EmptyState title={t("No saved drafts", "Belum ada draf tersimpan")} />
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
                  <Badge className={DRAFT_STATUS[d.status].style}>{DRAFT_STATUS[d.status].label}</Badge>
                </summary>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-slate-800">{d.body}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyButton text={d.body} />
                  {d.status === "DRAFT" && (
                    <Button variant="secondary" onClick={() => act(d, "sent")} disabled={!online}>
                      <Send className="h-4 w-4" aria-hidden /> {t("I sent it myself", "Sudah aku kirim sendiri")}
                    </Button>
                  )}
                  {d.status === "DRAFT" && canEmail && (
                    <Button variant="secondary" onClick={() => setSending({ draft: d, via: "email" })} disabled={!online}>
                      <AtSign className="h-4 w-4" aria-hidden /> {t("Send by email…", "Kirim lewat email…")}
                    </Button>
                  )}
                  {d.status === "DRAFT" && canTeam && (
                    <Button variant="secondary" onClick={() => setSending({ draft: d, via: "team" })} disabled={!online}>
                      <Users className="h-4 w-4" aria-hidden /> {t("Post to", "Posting ke")} {channels?.team_channel_name}…
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => act(d, "delete")} disabled={!online} aria-label={t("Delete draft", "Hapus draf")}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                  {d.task_id && (
                    <Link href={`/tasks/${d.task_id}`} className="self-center text-xs font-semibold text-brand-700">
                      {d.shipment_reference || t("Open task", "Buka task")}
                    </Link>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {sending && (
        <SendModal
          draft={sending.draft}
          via={sending.via}
          channelName={channels?.team_channel_name ?? t("team channel", "channel tim")}
          onClose={() => setSending(null)}
          onSent={async () => {
            setSending(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

/** Human review and approval of one specific message before it leaves the application. */
function SendModal({
  draft,
  via,
  channelName,
  onClose,
  onSent,
}: {
  draft: CommunicationDraft;
  via: "email" | "team";
  channelName: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipients = to
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      if (via === "email") await api.post(`/api/automation/drafts/${draft.id}/email`, { to: recipients, approve: true });
      else await api.post(`/api/automation/drafts/${draft.id}/team`, { approve: true });
      onSent();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal open title={via === "email" ? t("Send by email", "Kirim lewat email") : `${t("Post to", "Posting ke")} ${channelName}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {via === "email" && (
          <Field
            label={t("To", "Kepada")}
            htmlFor="send-to"
            hint={t("Up to 5 addresses, separated by commas. Check them carefully.", "Maksimal 5 alamat, dipisahkan koma. Cek dengan teliti.")}
          >
            <input id="send-to" type="email" multiple className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        )}
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="font-semibold text-slate-900">{draft.subject}</p>
          <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-slate-700">{draft.body}</p>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
          <span>
            {via === "email"
              ? t(
                  "I reviewed this message and the recipients, and I approve sending it now.",
                  "Aku sudah mengecek pesan ini dan penerimanya, dan aku setuju mengirimnya sekarang.",
                )
              : t("I reviewed this message, and I approve sending it now.", "Aku sudah mengecek pesan ini, dan aku setuju mengirimnya sekarang.")}
          </span>
        </label>
        <InlineError message={error} />
        <Button block loading={busy} disabled={!approved || (via === "email" && (recipients.length === 0 || recipients.length > 5))} onClick={send}>
          {via === "email" ? t("Send email", "Kirim email") : t("Post message", "Posting pesan")}
        </Button>
      </div>
    </Modal>
  );
}

"use client";

import { ArrowDown, ArrowUp, Bot, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, Card, Field, Modal, SectionTitle, inputClass } from "@/components/ui";
import { useDocumentSettings, useDocumentStatus } from "@/features/document-ai/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import type { DocumentSettings } from "@/types";

export function DocumentSettingsCard() {
  const online = useOnline();
  const { data: status, mutate: mutateStatus } = useDocumentStatus();
  const { data, mutate } = useDocumentSettings();
  const [threshold, setThreshold] = useState(85);
  const [tolerance, setTolerance] = useState(0);
  const [items, setItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [policyChecked, setPolicyChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!data) return;
    setThreshold(Math.round(data.review_threshold * 100));
    setTolerance(data.weight_tolerance_pct);
    setItems(data.final_checklist);
  }, [data]);

  async function save(body: Record<string, unknown>, ok = t("Saved.", "Tersimpan.")) {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.put<DocumentSettings>("/api/documents/settings", body);
      await mutate(updated, { revalidate: false });
      await mutateStatus();
      setMessage({ text: ok, ok: true });
      return true;
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data || !status) return null;

  const move = (i: number, dir: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setItems(next);
  };

  return (
    <Card>
      <div id="documents" className="scroll-mt-20" />
      <SectionTitle>{t("Documents", "Dokumen")}</SectionTitle>
      {message && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} role="status">
          {message.text}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 p-3">
        <p className="flex items-center gap-2 font-medium text-slate-900">
          <Bot className="h-4 w-4 text-slate-500" aria-hidden /> {t("AI document reading", "Pembacaan dokumen AI")}
        </p>
        {!status.ai_configured ? (
          <p className="mt-1 text-sm text-slate-600">
            <strong>Integration Required.</strong>{" "}
            {t(
              "No AI provider is configured on this server (AI_PROVIDER). Documents are stored and fields are entered by hand.",
              "Belum ada penyedia AI yang diatur di server ini (AI_PROVIDER). Dokumen disimpan dan field diisi manual.",
            )}
          </p>
        ) : status.is_demo ? (
          <p className="mt-1 text-sm text-slate-600">
            {t(
              "Not available for demo accounts. Demo uploads are never sent to an AI provider.",
              "Tidak tersedia untuk akun demo. Unggahan demo tidak pernah dikirim ke penyedia AI.",
            )}
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">
              {t("Provider", "Penyedia")}: {status.ai_provider === "anthropic" ? `Claude (${status.ai_model})` : status.ai_provider}.{" "}
              {t(
                "When on, uploaded files are sent to this provider to read the fields. Every value still needs your review.",
                "Kalau aktif, file yang diunggah dikirim ke penyedia ini untuk membaca field. Setiap nilai tetap perlu kamu cek.",
              )}
            </p>
            <label className="mt-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-800">{data.ai_processing_allowed ? t("On", "Aktif") : t("Off", "Mati")}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-600"
                checked={data.ai_processing_allowed}
                disabled={!online || busy}
                onChange={(e) => {
                  if (e.target.checked) {
                    setPolicyChecked(false);
                    setConfirmOpen(true);
                  } else {
                    save({ ai_processing_allowed: false }, t("AI document reading switched off.", "Pembacaan dokumen AI dimatikan."));
                  }
                }}
                aria-label={t("AI document reading", "Pembacaan dokumen AI")}
              />
            </label>
          </>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label={t(`Review fields below ${threshold}% AI confidence`, `Cek field dengan keyakinan AI di bawah ${threshold}%`)}
          htmlFor="threshold"
          hint={t("Higher means more fields are checked by hand.", "Makin tinggi, makin banyak field yang dicek manual.")}
        >
          <input id="threshold" type="range" min={50} max={99} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full accent-brand-600" />
        </Field>
        <Field
          label={t("Weight tolerance (%)", "Toleransi berat (%)")}
          htmlFor="tolerance"
          hint={t(
            "0 means any difference is reported. Your setting, not company policy.",
            "0 berarti selisih sekecil apa pun dilaporkan. Pengaturanmu, bukan kebijakan perusahaan.",
          )}
        >
          <input id="tolerance" type="number" min={0} max={10} step={0.1} className={inputClass} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
        </Field>
      </div>
      <Button
        className="mt-3"
        variant="secondary"
        disabled={!online || busy}
        onClick={() => save({ review_threshold: threshold / 100, weight_tolerance_pct: tolerance })}
      >
        {t("Save review settings", "Simpan pengaturan cek")}
      </Button>

      <div className="mt-5">
        <p className="text-sm font-semibold text-slate-800">{t("Final checklist before completing a task", "Checklist akhir sebelum menyelesaikan task")}</p>
        <p className="text-xs text-slate-500">
          {t("Your personal checklist. It never changes or replaces official SOP.", "Checklist pribadimu. Tidak pernah mengubah atau menggantikan SOP resmi.")}
        </p>
        <ul className="mt-2 space-y-1.5">
          {items.map((item, i) => (
            <li key={item} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span className="flex-1">{item}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-slate-400 disabled:opacity-30" aria-label={`${t("Move up", "Naikkan")}: ${item}`}>
                <ArrowUp className="h-4 w-4" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded p-1 text-slate-400 disabled:opacity-30" aria-label={`${t("Move down", "Turunkan")}: ${item}`}>
                <ArrowDown className="h-4 w-4" />
              </button>
              <button onClick={() => setItems(items.filter((x) => x !== item))} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`${t("Remove", "Hapus")}: ${item}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            className={inputClass}
            placeholder={t("Add a checklist item", "Tambah item checklist")}
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newItem.trim()) {
                setItems([...items, newItem.trim()]);
                setNewItem("");
              }
            }}
            aria-label={t("New checklist item", "Item checklist baru")}
          />
          <Button
            variant="secondary"
            onClick={() => {
              if (newItem.trim()) setItems([...items, newItem.trim()]);
              setNewItem("");
            }}
            aria-label={t("Add checklist item", "Tambah item checklist")}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <Button className="mt-3" disabled={!online || busy} onClick={() => save({ final_checklist: items }, t("Checklist saved.", "Checklist tersimpan."))}>
          {t("Save checklist", "Simpan checklist")}
        </Button>
      </div>

      <Modal open={confirmOpen} title={t("Turn on AI document reading?", "Aktifkan pembacaan dokumen AI?")} onClose={() => setConfirmOpen(false)}>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            {t("Uploaded documents will be sent to", "Dokumen yang diunggah akan dikirim ke")}{" "}
            <strong>{status.ai_provider === "anthropic" ? `Anthropic (Claude, ${status.ai_model})` : status.ai_provider}</strong>{" "}
            {t(
              "to read the fields. Company and client documents may contain confidential information.",
              "untuk membaca field. Dokumen perusahaan dan klien bisa memuat informasi rahasia.",
            )}
          </p>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={policyChecked} onChange={(e) => setPolicyChecked(e.target.checked)} />
            <span>
              {t(
                "I confirm that my organization's policy explicitly permits this application and this AI provider to process these documents.",
                "Aku menyatakan bahwa kebijakan organisasiku secara tegas mengizinkan aplikasi ini dan penyedia AI ini memproses dokumen tersebut.",
              )}
            </span>
          </label>
          <Button
            block
            loading={busy}
            disabled={!policyChecked}
            onClick={async () => {
              if (await save({ ai_processing_allowed: true, confirm_policy: true }, t("AI document reading switched on.", "Pembacaan dokumen AI diaktifkan.")))
                setConfirmOpen(false);
            }}
          >
            {t("Turn on", "Aktifkan")}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

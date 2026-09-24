"use client";

import { BadgeCheck, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { SearchModeNote } from "@/components/assistant/SearchModeNote";
import { SourceList } from "@/components/assistant/SourceList";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, PageHeader, Spinner, inputClass } from "@/components/ui";
import { useKnowledge, useRefreshAssistant } from "@/features/assistant/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useDebounced, useOnline } from "@/lib/hooks";
import { KNOWLEDGE_CATEGORY_LABEL } from "@/lib/utils/labels";
import type { KnowledgeCategory, KnowledgeNote } from "@/types";

const CATEGORIES = Object.keys(KNOWLEDGE_CATEGORY_LABEL) as KnowledgeCategory[];
type Draft = Pick<KnowledgeNote, "title" | "body" | "category" | "source_label" | "verified" | "tags"> & { id?: string };
const EMPTY: Draft = { title: "", body: "", category: "TRAINING", source_label: "", verified: false, tags: "" };

export default function KnowledgePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Knowledge />
    </Suspense>
  );
}

function Knowledge() {
  const params = useSearchParams();
  const router = useRouter();
  const online = useOnline();
  const refresh = useRefreshAssistant();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory | "">("");
  const debounced = useDebounced(query, 300);
  const { data, error, mutate } = useKnowledge(debounced, category);

  const [editing, setEditing] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Links from search results and answers open the note directly
  const noteParam = params.get("note");
  useEffect(() => {
    if (!noteParam) return;
    api
      .get<KnowledgeNote>(`/api/knowledge/${noteParam}`)
      .then((n) => setEditing(n))
      .catch(() => undefined);
  }, [noteParam]);

  function close() {
    setEditing(null);
    setConfirmDelete(false);
    setFormError(null);
    if (noteParam) router.replace("/knowledge");
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setFormError(null);
    const { id, ...body } = editing;
    try {
      if (id) await api.patch(`/api/knowledge/${id}`, body);
      else await api.post("/api/knowledge", body);
      await refresh();
      close();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing?.id) return;
    setBusy(true);
    try {
      await api.delete(`/api/knowledge/${editing.id}`);
      await refresh();
      close();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Knowledge"
        subtitle="Your trusted notes. Search here before asking others."
        action={
          <Button onClick={() => setEditing({ ...EMPTY })} disabled={!online}>
            <Plus className="h-4 w-4" aria-hidden /> Add
          </Button>
        }
      />

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className={`${inputClass} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes, learning, answered questions…" aria-label="Search knowledge" />
        </div>
        <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as KnowledgeCategory | "")} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {KNOWLEDGE_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <SearchModeNote />
      </div>

      <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        Personal knowledge. It never replaces official SOP. Mark a note as confirmed only when it was checked against an official source or with a
        senior. Do not store confidential client data unless your organization permits it.
      </p>

      {error && <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />}
      {!data && !error && <Spinner />}

      {data?.mode === "search" &&
        (data.results.length ? (
          <SourceList sources={data.results} />
        ) : (
          <EmptyState title="No reliable source found">Please verify with the appropriate person, then save the answer here.</EmptyState>
        ))}

      {data?.mode === "list" &&
        (data.items.length ? (
          <ul className="space-y-2">
            {data.items.map((n) => (
              <li key={n.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{n.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <Badge className="bg-slate-100 text-slate-700">{KNOWLEDGE_CATEGORY_LABEL[n.category]}</Badge>
                      {n.verified && (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Confirmed
                        </span>
                      )}
                      {n.source_label && <span className="text-slate-500">{n.source_label}</span>}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => setEditing(n)} aria-label={`Edit ${n.title}`}>
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                {n.body && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-slate-700">{n.body}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={category ? "No notes in this category" : "No notes yet"}>
            Add training notes, SOP references, terminology and answers you received. Answered questions can be saved here automatically.
          </EmptyState>
        ))}

      <Modal open={!!editing} title={editing?.id ? "Edit note" : "Add a note"} onClose={close}>
        {editing && (
          <div className="space-y-3">
            <Field label="Title" htmlFor="note-title">
              <input id="note-title" className={inputClass} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={200} />
            </Field>
            <Field label="Category" htmlFor="note-category">
              <select
                id="note-category"
                className={inputClass}
                value={editing.category}
                onChange={(e) => setEditing({ ...editing, category: e.target.value as KnowledgeCategory })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {KNOWLEDGE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Content" htmlFor="note-body">
              <textarea id="note-body" rows={6} className={inputClass} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} maxLength={10000} />
            </Field>
            <Field label="Source" htmlFor="note-source" hint="Where it comes from, e.g. “SOP section 2” or “Senior, 12 Sep”.">
              <input id="note-source" className={inputClass} value={editing.source_label} onChange={(e) => setEditing({ ...editing, source_label: e.target.value })} maxLength={200} />
            </Field>
            <Field label="Tags (optional)" htmlFor="note-tags">
              <input id="note-tags" className={inputClass} value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} maxLength={200} />
            </Field>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={editing.verified} onChange={(e) => setEditing({ ...editing, verified: e.target.checked })} />
              <span>Confirmed against an official source or with a senior</span>
            </label>
            <InlineError message={formError} />
            {confirmDelete ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
                <Button variant="danger" loading={busy} onClick={remove}>
                  Delete note
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                {editing.id && (
                  <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete note">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
                <Button className="flex-1" loading={busy} disabled={!online || editing.title.trim().length < 2} onClick={save}>
                  Save
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

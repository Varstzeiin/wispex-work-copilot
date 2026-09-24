"use client";

import useSWR, { useSWRConfig } from "swr";

import { fetcher } from "@/lib/api/client";
import type { DocumentItem, DocumentSettings, DocumentStatus, ShipmentDetail, ShipmentGroup, UploadResult } from "@/types";

// While anything is still being analysed, poll a little faster so results appear on their own
const whileProcessing = (busy: boolean) => (busy ? 3_000 : 0);

export function useDocumentStatus() {
  return useSWR<DocumentStatus>("/api/documents/status", fetcher);
}

export function useDocumentSettings() {
  return useSWR<DocumentSettings>("/api/documents/settings", fetcher);
}

export function useShipments() {
  const swr = useSWR<ShipmentGroup[]>("/api/documents/shipments", fetcher, {
    refreshInterval: (data) => whileProcessing(!!data?.some((g) => g.processing > 0)),
  });
  return swr;
}

export function useShipment(reference: string | null) {
  return useSWR<ShipmentDetail>(reference !== null ? `/api/documents/shipments/${encodeURIComponent(reference)}` : null, fetcher, {
    refreshInterval: (data) =>
      whileProcessing(!!data?.documents.some((d) => d.processing_status === "QUEUED" || d.processing_status === "PROCESSING")),
  });
}

export function useDocument(id: string) {
  return useSWR<DocumentItem>(`/api/documents/${id}`, fetcher, {
    refreshInterval: (data) => whileProcessing(data?.processing_status === "QUEUED" || data?.processing_status === "PROCESSING"),
  });
}

export function useReviewQueue() {
  return useSWR<{
    fields: (import("@/types").DocField & {
      document_id: string;
      original_filename: string;
      shipment_reference: string;
      document_type: string;
    })[];
    documents_without_type: { document_id: string; original_filename: string; shipment_reference: string }[];
  }>("/api/documents/review-queue", fetcher);
}

export function useRefreshDocuments() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/documents") || key.startsWith("/api/tasks") || key.startsWith("/api/planner")),
    );
}

/**
 * Multipart upload with progress and cancellation. fetch() cannot report upload progress,
 * so this uses XMLHttpRequest. Same-origin, so the session cookie is sent automatically.
 */
export function uploadWithProgress(
  form: FormData,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; cancel: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve, reject) => {
    xhr.open("POST", "/api/documents");
    xhr.setRequestHeader("X-Requested-With", "wispex");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as UploadResult);
      else reject(new Error((xhr.response && xhr.response.message) || "The upload could not be completed."));
    };
    xhr.onerror = () => reject(new Error("Cannot reach the server. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled. Nothing was saved."));
    xhr.send(form);
  });
  return { promise, cancel: () => xhr.abort() };
}

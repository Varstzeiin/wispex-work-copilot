/**
 * Small fetch wrapper. All calls go to the same origin (/api is proxied by Next.js),
 * so the httpOnly session cookie is sent automatically and never touched by scripts.
 */

import { getLang, t } from "@/lib/i18n";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const friendlyFallback = () =>
  t("Something went wrong. Nothing was changed. Please try again.", "Terjadi kesalahan. Tidak ada yang diubah. Silakan coba lagi.");

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        // Required by the backend CSRF check for any state-changing request
        "X-Requested-With": "wispex",
        // Text made by the server (reasons, summaries, messages) follows the chosen language
        "X-Language": getLang(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      t("Cannot reach the server. Check your connection and try again.", "Server tidak bisa dihubungi. Cek koneksi kamu lalu coba lagi."),
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON error pages (e.g. proxy errors) are never shown raw
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : data === null
          ? // Not our API's JSON: a proxy or hosting error page, so the backend was not reached
            t(
              "The server is not reachable right now. Nothing was changed. Please try again later.",
              "Server sedang tidak bisa dihubungi. Tidak ada yang diubah. Silakan coba lagi nanti.",
            )
          : response.status >= 500
            ? friendlyFallback()
            : t("The request could not be completed.", "Permintaan tidak bisa diselesaikan.");
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
};

export const fetcher = <T>(path: string) => api.get<T>(path);

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return friendlyFallback();
}

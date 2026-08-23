export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });

  let body: ApiEnvelope<T> | null = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. media stream) — caller should not use apiFetch for those.
  }

  if (!res.ok || !body?.ok) {
    // A 401 here means the session cookie didn't authenticate — either never
    // logged in, or (see lib/auth.ts requireSession) a stale session left
    // over from before a demo data reset. Either way, "internal error" is
    // the wrong message: send the user back to sign in instead of leaving
    // them stuck on a dead-end error with no path forward. Skip this on the
    // login page itself, where a 401 just means "wrong password."
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login?sessionExpired=1";
    }
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body?.details);
  }

  return body.data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: form });
}

/**
 * Converts a Blob to a base64 string (no data: URI prefix). Media uploads
 * go over JSON rather than multipart/form-data — see lib/api/media.ts for
 * why (a Next.js 14.2 Route Handler formData() parser bug on this stack).
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read media blob"));
    reader.readAsDataURL(blob);
  });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined });
}

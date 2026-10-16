// The hub's JSON endpoints (DX7), as the browser calls them: same-origin, behind Access. An error is DX7's
// `{error: <code>, message?}`, raised as a `HubRequestError` the views explain by its code.
import type { HubError } from 'desk-hub/protocol';

/** A hub endpoint's refusal, by DX7's error code. */
export class HubRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export async function hubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'manual', ...init });
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => null)) as HubError | null;
  throw new HubRequestError(response.status, body?.error ?? `http-${response.status}`, body?.message);
}

/** A request carrying `body` as JSON. */
export const withJson = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

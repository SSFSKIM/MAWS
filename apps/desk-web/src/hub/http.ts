// The hub's JSON endpoints (DX7), as the browser calls them: same-origin, behind Access. An error is DX7's
// `{error: <code>, message?}`, raised as a `HubRequestError` the views explain by its code.
import type { HubError } from 'desk-hub/protocol';
import { admissionGeneration, redirectedToSignIn } from './access';

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
  const at = admissionGeneration();
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'manual', ...init });
  if (response.ok) return (await response.json()) as T;
  if (response.type === 'opaqueredirect') {
    redirectedToSignIn(at); // Access's sign-in, which a fetch cannot follow: the views say so and offer it
    throw new HubRequestError(0, 'signed-out', 'Your sign-in has expired. Sign in again, then try once more.');
  }
  const body = (await response.json().catch(() => null)) as HubError | null;
  throw new HubRequestError(response.status, body?.error ?? `http-${response.status}`, body?.message);
}

/** A request carrying `body` as JSON. */
export const withJson = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

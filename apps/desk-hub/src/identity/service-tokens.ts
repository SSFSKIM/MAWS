// Cloudflare's Access service-token API, as the Registry uses it to give each enrolled machine its own credential:
// create (the secret is returned this once), list by name (to find an orphan whose create answer was lost), and
// delete by token id. Reached through a configured URL: Cloudflare's deployed, the stand-in's locally (local/).
import type { ApiConfig } from '../env';

export class ServiceTokenApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceTokenApiError';
  }
}

export type MintedToken = { id: string; client_id: string; client_secret: string };

type Envelope<T> = { success?: boolean; result?: T; errors?: Array<{ message?: string }> };

export function serviceTokens(config: ApiConfig, fetcher: typeof fetch = fetch) {
  const base = `${config.url.replace(/\/$/, '')}/accounts/${encodeURIComponent(config.account)}/access/service_tokens`;

  async function call<T>(method: string, url: string, body?: unknown, missingOk = false): Promise<T | undefined> {
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers: { Authorization: `Bearer ${config.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new ServiceTokenApiError(`${method} service_tokens: ${String(error)}`);
    }
    if (missingOk && response.status === 404) return undefined;
    const parsed = (await response.json().catch(() => ({}))) as Envelope<T>;
    if (!response.ok || parsed.success === false) {
      throw new ServiceTokenApiError(`${method} service_tokens: ${response.status} ${parsed.errors?.map((e) => e.message).join('; ') ?? ''}`);
    }
    return parsed.result;
  }

  return {
    /** Mints a token that never expires (a machine's credential lasts until it is revoked). */
    async create(name: string): Promise<MintedToken> {
      const result = await call<MintedToken>('POST', base, { name, duration: 'forever' });
      if (!result || typeof result.id !== 'string' || typeof result.client_id !== 'string' || typeof result.client_secret !== 'string') {
        throw new ServiceTokenApiError('POST service_tokens: no token in the answer');
      }
      return { id: result.id, client_id: result.client_id, client_secret: result.client_secret };
    },

    /** The ids of every token carrying exactly this name. */
    async named(name: string): Promise<string[]> {
      const result = await call<Array<{ id: string; name: string }>>('GET', `${base}?name=${encodeURIComponent(name)}&per_page=1000`);
      return (result ?? []).filter((t) => t.name === name).map((t) => t.id);
    },

    /** Deletes a token; one already gone counts as deleted. */
    async delete(id: string): Promise<void> {
      await call('DELETE', `${base}/${encodeURIComponent(id)}`, undefined, true);
    },

    /** Deletes every token with this name: a previous credential being rotated, and any orphan of a lost answer. */
    async deleteNamed(name: string): Promise<void> {
      for (const id of await this.named(name)) await this.delete(id);
    },
  };
}

export type ServiceTokens = ReturnType<typeof serviceTokens>;

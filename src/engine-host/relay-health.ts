// Relay health (charter D-19, §7.4; C3 execution document, Interfaces "Relay health"): `GET /api/hello` on
// ClaudeUsage's loopback gateway. `session.launch` with `gateway: 'gateway'` calls it first and answers
// `relay_unreachable` without spawning when it fails; `engine.relayHealth` answers it on demand. `http.request` with
// `Connection: close`, never `fetch`, so the socket count stays flat when nine sessions start. The check never
// reaches Anthropic.
import { request } from 'node:http';
import { RELAY_URL } from './launch';

export interface RelayHealth {
  url: string;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  checkedAt: string;
  error: string | null;
}

export const RELAY_HEALTH_TIMEOUT_MS = 1_500;
export const RELAY_HEALTH_CACHE_MS = 5_000;

const cache = new Map<string, { health: RelayHealth; expiresAt: number }>();

export function resetRelayHealthCache(): void {
  cache.clear();
}

function probe(url: string, timeoutMs: number): Promise<RelayHealth> {
  const started = Date.now();
  const checkedAt = new Date(started).toISOString();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (health: Omit<RelayHealth, 'url' | 'checkedAt' | 'latencyMs'>) => {
      if (settled) return;
      settled = true;
      resolve({ url, checkedAt, latencyMs: Date.now() - started, ...health });
    };
    const req = request(`${url}/api/hello`, { method: 'GET', headers: { connection: 'close' }, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? null;
      res.resume(); // drain so the socket closes
      res.on('end', () => finish({ ok: status === 200, status, error: status === 200 ? null : `HTTP ${status ?? '?'}` }));
      res.on('error', (error) => finish({ ok: false, status, error: error.message }));
    });
    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${timeoutMs} ms`));
    });
    req.on('error', (error) => finish({ ok: false, status: null, error: error.message }));
    req.end();
  });
}

// Results are cached 5 s per url; `force` bypasses the cache (engine.relayHealth { force: true }, M5).
export async function checkRelay(url: string = RELAY_URL, timeoutMs: number = RELAY_HEALTH_TIMEOUT_MS, opts: { force?: boolean } = {}): Promise<RelayHealth> {
  const now = Date.now();
  const hit = cache.get(url);
  if (!opts.force && hit && hit.expiresAt > now) return hit.health;
  const health = await probe(url, timeoutMs);
  cache.set(url, { health, expiresAt: Date.now() + RELAY_HEALTH_CACHE_MS });
  return health;
}

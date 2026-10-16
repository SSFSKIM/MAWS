// The local-hub suites' cleanup: every machine they enrolled is revoked, and one that was not is reported by name, so
// a run never leaves machines enrolled in the persistent local org while claiming it revoked them all.
import { describe, expect, it } from 'vitest';
import { revokeMachines } from './revoke';

describe('revokeMachines', () => {
  it('revokes each name and reports every one the hub did not, with why', async () => {
    const asked: string[] = [];
    const hub = (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method} ${url}`);
      if (url.endsWith('/gone-already')) return new Response(JSON.stringify({ error: 'unknown-machine' }), { status: 404 });
      if (url.endsWith('/unreachable')) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ revoked: url.slice(url.lastIndexOf('/') + 1) }), { status: 200 });
    }) as typeof fetch;
    const left = await revokeMachines('http://hub', ['fm-1', 'gone-already', 'unreachable', 'fm 2'], hub);
    expect(asked).toEqual([
      'DELETE http://hub/api/machines/fm-1',
      'DELETE http://hub/api/machines/gone-already',
      'DELETE http://hub/api/machines/unreachable',
      'DELETE http://hub/api/machines/fm%202',
    ]);
    expect(left).toEqual(['gone-already (404 {"error":"unknown-machine"})', 'unreachable (unreachable: fetch failed)']);
  });

  it('reports nothing when every revocation succeeded', async () => {
    const hub = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    expect(await revokeMachines('http://hub', ['a', 'b'], hub)).toEqual([]);
  });
});

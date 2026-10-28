// Endpoint records as the link dials them (P5 O7 M1, "Endpoint records"): verified, the newest kept, cached in a 0600
// file that is verified again at load, and used when the hub doesn't answer.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { generateSigningKey, memoryOrgView, signRecord, SIGNING_DOMAINS, type EndpointRecord, type Signed, type SigningKey } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { genesis, memberId, newDevice, successor } from '../../../../test/endpoint/org-fixtures';
import type { SignedIn } from '../../org/session';
import { createEndpointRecords, ENDPOINT_RECORDS_FILE } from './endpoint-records';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'maws-records-'));
  dirs.push(dir);
  const a1 = await newDevice('a1');
  const A = memberId();
  const ref = randomBytes(16).toString('base64url') as MachineRef;
  const key = await generateSigningKey();
  const s1 = await genesis('org-r', A, a1, await generateSigningKey());
  const s2 = await successor(s1, [a1], (s) => {
    s.machines.push({ name: 'mini', ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref });
  });
  const signedIn = { view: memoryOrgView({ chain: [s1, s2] }), hub: { url: 'http://hub.test', headers: async () => ({ 'x-member': 'a' }) } } as unknown as SignedIn;
  const record = (issued: string, by: SigningKey = key, addresses = ['ws://100.64.0.1:47830']): Promise<Signed<EndpointRecord>> =>
    signRecord(SIGNING_DOMAINS.endpoint, { org: 'org-r', machine: ref, addresses, issued }, by.privateKey, by.pub);
  const hub: { answer: Signed<EndpointRecord> | null | 'down'; seen: Array<{ url: string; headers: unknown }> } = { answer: null, seen: [] };
  const fetch = (async (url: string, init: { headers: unknown }) => {
    hub.seen.push({ url, headers: init.headers });
    if (hub.answer === 'down') throw new Error('ECONNREFUSED');
    if (hub.answer === null) return new Response(JSON.stringify({ error: 'no-endpoint' }), { status: 404 });
    return new Response(JSON.stringify({ record: hub.answer }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const file = join(dir, ENDPOINT_RECORDS_FILE);
  const logs: string[] = [];
  const records = () => createEndpointRecords({ file, fetch, log: (l) => void logs.push(l) });
  return { ref, signedIn, record, hub, file, records, logs };
}

describe('endpoint records', () => {
  it('fetches with the hub’s headers, ignores a record that fails verification, and keeps the newest issued', async () => {
    const s = await setup();
    const r = s.records();
    s.hub.answer = await s.record('2026-10-28T10:00:00.000Z', await generateSigningKey());
    expect(await r.resolve(s.ref, s.signedIn)).toBeNull();
    expect(s.hub.seen[0]).toEqual({ url: `http://hub.test/api/machines/${s.ref}/endpoint`, headers: { 'x-member': 'a' } });
    const newer = await s.record('2026-10-28T11:00:00.000Z');
    s.hub.answer = newer;
    expect(await r.resolve(s.ref, s.signedIn)).toEqual(newer);
    s.hub.answer = await s.record('2026-10-28T09:00:00.000Z');
    expect(await r.resolve(s.ref, s.signedIn)).toEqual(newer);
  });

  it('writes the cache 0600, verifies it again at load, and uses it when the hub is away', async () => {
    const s = await setup();
    const held = await s.record('2026-10-28T11:00:00.000Z');
    s.hub.answer = held;
    await s.records().resolve(s.ref, s.signedIn);
    expect(statSync(s.file).mode & 0o777).toBe(0o600);
    s.hub.answer = 'down';
    expect(await s.records().resolve(s.ref, s.signedIn)).toEqual(held); // a relaunch: read from the file
    // a cached record the held state no longer verifies is not used
    const forged = await s.record('2026-10-28T12:00:00.000Z', await generateSigningKey());
    writeFileSync(s.file, JSON.stringify({ version: 1, records: { [s.ref]: forged } }), { mode: 0o600 });
    expect(await s.records().resolve(s.ref, s.signedIn)).toBeNull();
  });

  it('reads a file that does not parse as empty, with a log line', async () => {
    const s = await setup();
    writeFileSync(s.file, '{not json', { mode: 0o600 });
    s.hub.answer = 'down';
    expect(await s.records().resolve(s.ref, s.signedIn)).toBeNull();
    expect(s.logs.some((l) => l.includes('does not read'))).toBe(true);
    s.hub.answer = await s.record('2026-10-28T11:00:00.000Z');
    await s.records().resolve(s.ref, s.signedIn);
    expect(JSON.parse(readFileSync(s.file, 'utf8')).version).toBe(1);
  });
});

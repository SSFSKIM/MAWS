// P5 O4 M1: the legacy reader and the one-pass adoption driver (./legacy-custody.ts; docs/doperpowers/plans/2026-10-31-
// p5-o4-services.md, Interfaces §B, Decision Log D3 and D32). A reversible fake stands in for Electron's safeStorage and a
// recording fake for `connectors.adoptGrant`; no keychain is touched.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorOAuthRecord } from '@shared/connectors/oauth-types';
import { SEALED_FORMAT_V1, SEALED_FORMAT_V2, type ConnectorOAuthSealer } from '@shared/connectors/sealer';
import { ADOPTION_PROBE_ID, adoptLegacy, listLegacy } from './legacy-custody';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const record = (connectionId: string): ConnectorOAuthRecord => ({
  connectionId,
  identity: { requestUrl: `https://mcp.example.com/${connectionId}`, server: 'metrics', scope: 'user', configPath: '/home/o/.claude.json', entryPath: ['mcpServers', 'metrics'] },
  issuer: 'https://auth.example.com',
  resource: 'https://mcp.example.com',
  redirectUri: 'http://127.0.0.1:53100/callback',
  authorizationServer: { issuer: 'https://auth.example.com', authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token', response_types_supported: ['code'] },
  client: { client_id: 'client-1', redirect_uris: ['http://127.0.0.1:53100/callback'] },
  tokens: { accessToken: `at-${connectionId}`, refreshToken: `rt-${connectionId}`, tokenType: 'Bearer', obtainedAt: 1_700_000_000_000 },
  savedAt: 1_700_000_100_000,
});

const xor = (bytes: Buffer) => Buffer.from(bytes.map((byte) => byte ^ 0x5a));

// Electron's sealer, as far as the driver sees it: format 1, ignores the id; `failOn` the ids it cannot open, the
// probe's included; `probe` how its round trip goes wrong.
class FakeElectronSealer implements ConnectorOAuthSealer {
  readonly format = SEALED_FORMAT_V1;
  isAvailable = true;
  probe: 'passes' | 'seal throws' | 'open throws' | 'text differs' = 'passes';
  readonly failOn = new Set<string>();
  readonly opened: string[] = [];
  async available() { return this.isAvailable; }
  async seal(text: string, id: string) {
    if (id === ADOPTION_PROBE_ID && this.probe === 'seal throws') throw new Error('the keychain denied it');
    return xor(Buffer.from(text, 'utf8'));
  }
  async open(sealed: Buffer, id: string) {
    this.opened.push(id);
    if (this.failOn.has(id) || (id === ADOPTION_PROBE_ID && this.probe === 'open throws')) throw new Error('the keychain denied it');
    if (id === ADOPTION_PROBE_ID && this.probe === 'text differs') return { text: 'something else', reseal: false };
    return { text: xor(sealed).toString('utf8'), reseal: false };
  }
}

let root: string;
let dir: string;
let sealer: FakeElectronSealer;
let logged: string[];
let adopted: { connectionId: string; record: ConnectorOAuthRecord }[];
let answer: (connectionId: string) => Promise<{ adopted: boolean; reason?: string }>;

const plant = (id: string, format = SEALED_FORMAT_V1, json: unknown = { version: 1, ...record(id) }) =>
  writeFileSync(join(dir, `${id}.sealed`), `${format}\n${xor(Buffer.from(JSON.stringify(json), 'utf8')).toString('base64')}\n`, { mode: 0o600 });
const adopt = () =>
  adoptLegacy({
    directory: dir,
    sealer,
    adopt: async (connectionId, value) => {
      adopted.push({ connectionId, record: value });
      return answer(connectionId);
    },
    log: (line) => logged.push(line),
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-legacy-custody-'));
  dir = join(root, 'connectors', 'oauth');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  sealer = new FakeElectronSealer();
  logged = [];
  adopted = [];
  answer = async () => ({ adopted: true });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('listLegacy', () => {
  it('names the format 1 files only, read without a sealer', async () => {
    plant(B);
    plant(A);
    plant(C, SEALED_FORMAT_V2);
    writeFileSync(join(dir, `${D}.sealed`), 'garbage', { mode: 0o600 });
    writeFileSync(join(dir, 'not-a-uuid.sealed'), `${SEALED_FORMAT_V1}\nAAAA\n`, { mode: 0o600 });
    writeFileSync(join(dir, 'key'), Buffer.alloc(32), { mode: 0o600 });
    expect(await listLegacy(dir)).toEqual([A, B]);
  });

  it('follows no link and lists nothing for a missing directory', async () => {
    plant(A);
    symlinkSync(join(dir, `${A}.sealed`), join(dir, `${B}.sealed`));
    expect(await listLegacy(dir)).toEqual([A]);
    expect(await listLegacy(join(root, 'missing'))).toEqual([]);
  });
});

describe('adoptLegacy', () => {
  it('hands every readable record to adopt once, in one pass, and never touches a file', async () => {
    for (const id of [A, B, C]) plant(id);
    const before = readdirSync(dir).map((name) => readFileSync(join(dir, name), 'utf8'));
    expect(await adopt()).toEqual({ adopted: 3, left: 0, stopped: false });
    expect(adopted).toEqual([A, B, C].map((connectionId) => ({ connectionId, record: record(connectionId) })));
    expect(readdirSync(dir).map((name) => readFileSync(join(dir, name), 'utf8'))).toEqual(before);
    expect(logged).toEqual(['[connectors] adopted 3 of 3 legacy grants']);
  });

  it.each(['seal throws', 'open throws', 'text differs'] as const)('a probe whose round trip fails (%s) stops the pass before any record is opened', async (how) => {
    for (const id of [A, B, C]) plant(id);
    sealer.probe = how;
    expect(await adopt()).toEqual({ adopted: 0, left: 3, stopped: true });
    expect(sealer.opened.filter((id) => id !== ADOPTION_PROBE_ID)).toEqual([]); // a denied keychain is not asked per record
    expect(adopted).toEqual([]);
    expect(logged).toEqual(['[connectors] adopted 0 of 3 legacy grants; stopped: the sealer is unavailable or failed its round trip, the next launch tries again']);
  });

  it('after a passing probe a damaged file is left wherever it sorts, the first included, and the rest are adopted', async () => {
    for (const id of [A, B, C, D]) plant(id);
    sealer.failOn.add(A);
    sealer.failOn.add(C);
    expect(await adopt()).toEqual({ adopted: 2, left: 2, stopped: false });
    expect(sealer.opened).toEqual([ADOPTION_PROBE_ID, A, B, C, D]);
    expect(adopted.map(({ connectionId }) => connectionId)).toEqual([B, D]);
    expect(logged).toEqual(['[connectors] adopted 2 of 4 legacy grants; left: unopened 2']);
  });

  it('stops before opening anything when the sealer is unavailable', async () => {
    plant(A);
    plant(B);
    sealer.isAvailable = false;
    expect(await adopt()).toEqual({ adopted: 0, left: 2, stopped: true });
    expect(sealer.opened).toEqual([]); // not even the probe
    expect(adopted).toEqual([]);
    expect(logged).toEqual(['[connectors] adopted 0 of 2 legacy grants; stopped: the sealer is unavailable or failed its round trip, the next launch tries again']);
  });

  it('asks nothing of the sealer when there is no format 1 file', async () => {
    plant(C, SEALED_FORMAT_V2);
    const touched = [vi.spyOn(sealer, 'available'), vi.spyOn(sealer, 'open')];
    expect(await adopt()).toEqual({ adopted: 0, left: 0, stopped: false });
    for (const spy of touched) expect(spy).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it('leaves a record the machine declined or could not take, and goes on', async () => {
    for (const id of [A, B, C]) plant(id);
    answer = async (id) => {
      if (id === A) return { adopted: false, reason: 'present' };
      if (id === B) throw new Error('the machine host is gone');
      return { adopted: true };
    };
    expect(await adopt()).toEqual({ adopted: 1, left: 2, stopped: false });
    expect(adopted.map(({ connectionId }) => connectionId)).toEqual([A, B, C]);
    expect(logged).toEqual(['[connectors] adopted 1 of 3 legacy grants; left: present 1, failed 1']);
  });

  it('leaves a record that opens to something other than its own version 1 record, without adopting it', async () => {
    plant(A, SEALED_FORMAT_V1, { version: 1, ...record(B) }); // another id's record under A's name
    plant(B, SEALED_FORMAT_V1, { ...record(B), version: 2 });
    writeFileSync(join(dir, `${C}.sealed`), `${SEALED_FORMAT_V1}\n${xor(Buffer.from('not json')).toString('base64')}\n`, { mode: 0o600 });
    plant(D);
    expect(await adopt()).toEqual({ adopted: 1, left: 3, stopped: false });
    expect(adopted.map(({ connectionId }) => connectionId)).toEqual([D]);
    expect(logged).toEqual(['[connectors] adopted 1 of 4 legacy grants; left: invalid 3']);
  });

  it('skips a record forgotten or adopted after the listing', async () => {
    plant(A);
    plant(B);
    sealer.open = async (sealed, id) => {
      if (id === A) rmSync(join(dir, `${B}.sealed`)); // a Forget lands while A is being opened
      return { text: xor(sealed).toString('utf8'), reseal: false };
    };
    expect(await adopt()).toEqual({ adopted: 1, left: 0, stopped: false });
    expect(adopted.map(({ connectionId }) => connectionId)).toEqual([A]);
  });
});

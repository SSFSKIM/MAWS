// The DX1 org key under the signed state's retirement (O14 M5a, Interfaces §B/§E): `legacy.json` follows the head's
// `legacyRetired` as a tombstone `{org, retired, key?}` that keeps the key's bytes until `legacy purge`; under it the
// endpoint asks sminos for no key, keeps none it is sent, signs v2-only, and delivers a v1 event down at once as an
// inert record (`{kind: 'legacy', checked: false}`), held and spent never; a head without the mark makes the bytes the
// key again at once.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64urlDecode, base64urlEncode, generateSigningKey, type Certificates, type OrgState, type SignedOrgState } from 'org-protocol';
import { importOrgKey, seal, verify } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { LegacyKey } from '../../../src/endpoint/rl10/legacy';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { LogRelay } from '../../../src/endpoint/rl10/log-relay';
import { Members } from '../../../src/endpoint/rl10/members';
import { SignatureLedger } from '../../../src/endpoint/rl10/signature-ledger';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice, successor, type TestDevice } from '../org-fixtures';
import { FakeSminos, type Frame } from './fake-sminos';

const ORG = 'org-legacy';
const P = '6c2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const NAME = 'host';
const REF = 'r4Hc2Wv9Kp0Lm8Tr1Xy7Zb';
const NO_CERTS: Certificates = { certs: [], retirements: [] };
const KEY = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));

const dirs: string[] = [];
const scratch = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10l-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A chain of the machine `host`: v2 lists it, v3 retires the legacy key, v4 drops the retirement. */
async function chain() {
  const a1: TestDevice = await newDevice('a1');
  const machine = await generateSigningKey();
  const A = memberId();
  const g = await genesis(ORG, A, a1, await generateSigningKey());
  const listed = await successor(g, [a1], (s) => {
    s.machines.push({ name: NAME, ref: REF, pub: machine.pub, owners: [A] });
    s.machineNames.push({ name: NAME, ref: REF });
  });
  const retired = await successor(listed, [a1], (s) => void (s.legacyRetired = { version: s.version, at: s.issued }));
  const restored = await successor(retired, [a1], (s) => void delete s.legacyRetired);
  return { machine, listed, retired, restored };
}

const legacyFile = (dir: string) => (fs.existsSync(join(dir, 'legacy.json')) ? (JSON.parse(fs.readFileSync(join(dir, 'legacy.json'), 'utf8')) as Record<string, unknown>) : null);

function members(): Members {
  return new Members({ dispatch: () => Promise.reject(new Error('none')), listings: { report: async () => {}, gone: async () => {} }, listed: () => [], forget: () => {}, log: () => {}, now: Date.now });
}

describe('legacy.json following the head', () => {
  it('becomes a tombstone that keeps the bytes at a retiring head, and the key again at a head without the mark', async () => {
    const { listed, retired, restored } = await chain();
    const dir = scratch();
    const state = EndpointState.open(dir);
    state.setLegacy({ org: ORG, key: KEY });
    const legacy = new LegacyKey(() => state, () => ORG);
    expect(legacy.follow(listed.state, false)).toBe(false);
    expect([legacy.held, legacy.retired]).toEqual([true, false]);
    expect(legacy.follow(retired.state, false)).toBe(true);
    expect(legacyFile(dir)).toEqual({ org: ORG, retired: retired.state.legacyRetired!.at, key: KEY });
    expect([legacy.held, legacy.retired, state.legacy, state.legacyRetired]).toEqual([false, true, false, true]);
    expect(await legacy.mac(P, { writer: `${NAME}/x`, seq: 1 })).toBeNull();
    // The file survives a restart as the tombstone.
    const reopened = EndpointState.open(dir);
    expect([reopened.legacy, reopened.legacyRetired]).toEqual([false, true]);
    expect(legacy.follow(restored.state, false)).toBe(true);
    expect(legacyFile(dir)).toEqual({ org: ORG, key: KEY });
    expect([legacy.held, legacy.retired]).toEqual([true, false]);
    expect(await legacy.mac(P, { writer: `${NAME}/x`, seq: 1 })).not.toBeNull();
  });

  it('writes a tombstone without bytes when the endpoint never held the key under a head that kept it', async () => {
    const { retired, restored } = await chain();
    // No key at all, a retiring head: a byteless tombstone, so sminos is never asked.
    const none = scratch();
    const empty = EndpointState.open(none);
    const legacy = new LegacyKey(() => empty, () => ORG);
    expect(legacy.follow(retired.state, false)).toBe(true);
    expect(legacyFile(none)).toEqual({ org: ORG, retired: retired.state.legacyRetired!.at });
    // A byteless tombstone under a head without the mark is no key: removed, as an endpoint that never had one.
    expect(legacy.follow(restored.state, false)).toBe(true);
    expect(legacyFile(none)).toBeNull();
    // The first sync's head retires: bytes the endpoint holds (a provisioning code's) are dropped.
    const first = scratch();
    const coded = EndpointState.open(first);
    coded.setLegacy({ org: ORG, key: KEY });
    expect(new LegacyKey(() => coded, () => ORG).follow(retired.state, true)).toBe(true);
    expect(legacyFile(first)).toEqual({ org: ORG, retired: retired.state.legacyRetired!.at });
  });

  it('purges the bytes from the tombstone and from every stale copy, and refuses while the key is in use', async () => {
    const { retired } = await chain();
    const dir = scratch();
    const state = EndpointState.open(dir);
    state.setLegacy({ org: ORG, key: KEY });
    const legacy = new LegacyKey(() => state, () => ORG);
    expect(() => legacy.purge()).toThrow(/not retired/);
    expect(legacy.status()).toEqual({ status: 'held', stale: 0 });
    const aside = join(dir, 'stale-2026-10-28T00-00-00.000Z');
    fs.mkdirSync(aside, { mode: 0o700 });
    fs.writeFileSync(join(aside, 'legacy.json'), JSON.stringify({ org: ORG, key: KEY }), { mode: 0o600 });
    legacy.follow(retired.state, false);
    expect(legacy.status()).toEqual({ status: 'retired (bytes kept)', stale: 1 });
    expect(legacy.purge()).toEqual(['legacy.json', 'stale-2026-10-28T00-00-00.000Z/legacy.json']);
    expect(legacyFile(dir)).toEqual({ org: ORG, retired: retired.state.legacyRetired!.at });
    expect(fs.existsSync(join(aside, 'legacy.json'))).toBe(false);
    expect(legacy.status()).toEqual({ status: 'purged', stale: 0 });
    expect(legacy.purge()).toEqual([]);
    for (const name of fs.readdirSync(dir, { recursive: true }) as string[]) {
      const path = join(dir, name);
      if (fs.statSync(path).isFile()) expect(fs.readFileSync(path, 'utf8')).not.toContain(KEY);
    }
  });
});

describe('RL10 under the tombstone', () => {
  async function served(head: () => { state: OrgState; certificates: Certificates }, legacy?: { org: string; key: string }) {
    const dir = scratch();
    const state = EndpointState.open(dir);
    if (legacy !== undefined) state.setLegacy(legacy);
    const lines: string[] = [];
    const rl10 = new Rl10({
      stateDir: () => dir,
      build: 'legacy',
      state: () => state,
      head,
      identity: () => ({ org: ORG, hub: 'http://127.0.0.1:1', name: NAME, ref: REF, enrolled: '2026-10-28T00:00:00.000Z' }),
      key: () => null,
      policy: new EndpointPolicy(() => state),
      hub: { openProject: () => () => {}, send: () => true },
      listings: { report: async () => {}, gone: async () => {}, refresh: async () => {}, listedSessions: () => [] },
      notifier: { pendingSet: () => {}, hostMessage: () => {}, forget: () => {} },
      machineOwners: async () => [],
      dispatch: () => Promise.reject(new Error('none')),
      now: Date.now,
      log: (line) => void lines.push(line),
    });
    rl10.legacy.follow(head().state, false);
    await rl10.serve();
    closers.push(() => rl10.unserve());
    const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
    const connect = async () => {
      const sminos = await FakeSminos.open(info.socket);
      closers.push(() => sminos.close());
      sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'legacy' }, policy: { read_only: false, ceiling: 'settings' } });
      await sminos.next((f) => f.t === 'welcome', 'the welcome');
      // The welcome's restatement (`revoked`, the directory) comes before any ask.
      await sminos.next((f) => f.t === 'org', 'the directory');
      return sminos;
    };
    return { rl10, state, dir, lines, connect };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
  const asked = (sminos: FakeSminos) => sminos.received.some((f) => f.t === 'legacy-key?');

  it('asks for no key across a reconnect, and drops a key it is sent', async () => {
    const { retired } = await chain();
    const { state, lines, connect, dir } = await served(() => ({ state: retired.state, certificates: NO_CERTS }));
    const first = await connect();
    await settle();
    expect(asked(first)).toBe(false);
    first.send({ t: 'legacy-key', org: ORG, key: KEY });
    await expect.poll(() => lines.some((l) => l.includes('not kept (retired)'))).toBe(true);
    expect(state.legacy).toBe(false);
    expect(legacyFile(dir)).toEqual({ org: ORG, retired: retired.state.legacyRetired!.at });
    first.close();
    const second = await connect();
    await settle();
    expect(asked(second)).toBe(false);
  });

  it('still asks under a head that retires nothing, the build changing nothing there', async () => {
    const { listed } = await chain();
    const { connect } = await served(() => ({ state: listed.state, certificates: NO_CERTS }));
    const sminos = await connect();
    await sminos.next((f) => f.t === 'legacy-key?', 'the ask');
  });

  it('delivers a v1 event at once as an inert record, holding and spending nothing; the key back, it is checked again', async () => {
    const { retired, restored } = await chain();
    let head = retired;
    const { rl10, connect } = await served(() => ({ state: head.state, certificates: NO_CERTS }), { org: ORG, key: KEY });
    const sminos = await connect();
    sminos.send({ t: 'hello', project: P, name: 'maws', have: {} });
    await settle();
    const v1 = await seal(await importOrgKey(base64urlDecode(KEY)), 'log', P, { ts: new Date().toISOString(), writer: 'mini/human', seq: 1, kind: 'say', text: 'from DX1' });
    const forged = { ts: new Date().toISOString(), writer: 'mini/human', seq: 2, kind: 'say', text: 'no code', mac: { nonce: 'AAAAAAAAAAAAAAAAAAAAAA', value: 'B'.repeat(43) } };
    await rl10.relay.fromHub({ t: 'events', project: P, events: [v1, forged] });
    const down = await sminos.next((f) => f.t === 'events', 'the events down');
    expect(down.events).toEqual([
      { event: v1, signer: { kind: 'legacy', checked: false } },
      { event: forged, signer: { kind: 'legacy', checked: false } },
    ]);
    expect(rl10.relay.holding).toBe(0);
    expect(sminos.received.some((f: Frame) => f.t === 'spent')).toBe(false);
    // The retirement undone: the bytes are the key again, with no hello, and a v1 code is checked once more.
    head = restored;
    rl10.legacy.follow(head.state, false);
    expect(rl10.legacy.held).toBe(true);
    const later = await seal(await importOrgKey(base64urlDecode(KEY)), 'log', P, { ts: new Date().toISOString(), writer: 'mini/human', seq: 3, kind: 'say', text: 'checked' });
    await rl10.relay.fromHub({ t: 'events', project: P, events: [later] });
    const checked = await sminos.next((f) => f.t === 'events', 'the checked event');
    expect(checked.events).toEqual([{ event: later, signer: { kind: 'legacy' } }]);
    expect(await verify(await importOrgKey(base64urlDecode(KEY)), 'log', P, later)).toBe(true);
  });
});

describe('the upload under the tombstone', () => {
  it('signs v2-only: no mac while retired, the mac again once a head drops the mark', async () => {
    const { machine, retired, restored } = await chain();
    const dir = scratch();
    const state = EndpointState.open(dir);
    state.setLegacy({ org: ORG, key: KEY });
    const legacy = new LegacyKey(() => state, () => ORG);
    let head: SignedOrgState = retired;
    legacy.follow(head.state, false);
    const toHub: Frame[] = [];
    const relay = new LogRelay({
      org: () => ({ head: head.state, certificates: NO_CERTS, ref: REF, name: NAME }),
      key: () => ({ key: machine, keyId: 'k' }),
      members: members(),
      ledger: new SignatureLedger(() => state.subdirectory('signatures')),
      index: new InboundIndex(() => state.subdirectory('inbound'), Date.now),
      legacy,
      hub: { openProject: () => () => {}, send: (f) => (toHub.push(f), true) },
      toSminos: () => {},
      opened: () => {},
      now: Date.now,
      log: () => {},
    });
    const up = (seq: number) => ({ t: 'events', project: P, events: [{ ts: '2026-10-28T10:00:00.000Z', writer: `${NAME}/human`, seq, kind: 'say', text: `say ${seq}` }] });
    await relay.events(up(1));
    const first = (toHub[0].events as Array<Record<string, unknown>>)[0];
    expect(first.sig).toBeDefined();
    expect(first.mac).toBeUndefined();
    head = restored;
    legacy.follow(head.state, false);
    await relay.events(up(2));
    expect((toHub[1].events as Array<Record<string, unknown>>)[0].mac).toBeDefined();
  });
});

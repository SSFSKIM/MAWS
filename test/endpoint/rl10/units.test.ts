// RL10's parts the conversation replay (conversation.local.test.ts) can't reach on one run (O10 M6): the upload form and
// its derived `created`, the signature ledger and the inbound index across a restart (a torn last line, the 30-day
// window), the head's revocation set, and the socket itself (its token, its modes, its long-path fallback).
import * as fs from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { revocationSet } from '../../../src/endpoint/rl10/org-directory';
import { InboundIndex, INBOUND_KEPT_MS } from '../../../src/endpoint/rl10/inbound-index';
import { HOLD_MAX, HOLD_MS, LogRelay, type RelayContext } from '../../../src/endpoint/rl10/log-relay';
import { Rl10Server, socketPath, type Frame } from '../../../src/endpoint/rl10/server';
import { createdOf, SignatureLedger, uploadForm } from '../../../src/endpoint/rl10/signature-ledger';
import { genesis, memberId, newDevice, revokedDevice, successor } from '../org-fixtures';
import { base64urlEncode, generateSigningKey } from 'org-protocol';

const dirs: string[] = [];
const scratch = (prefix = 'rl10-') => {
  const dir = fs.mkdtempSync(join(tmpdir(), prefix));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the upload form', () => {
  it('derives created from ts: verbatim at milliseconds, .000Z for a whole second, none for anything else', () => {
    expect(createdOf('2026-10-27T18:02:11.482Z')).toBe('2026-10-27T18:02:11.482Z');
    expect(createdOf('2026-10-27T18:02:13Z')).toBe('2026-10-27T18:02:13.000Z');
    expect(createdOf('2026-10-27 18:02:13')).toBeNull();
    expect(createdOf(17)).toBeNull();
  });

  it('is the stored event with created, without what the endpoint adds or sminos keeps; a created other than ts is malformed', () => {
    const stored = { ts: '2026-10-27T18:02:13Z', writer: 'm/human', seq: 2, kind: 'human', text: 'hi', verified: { signer: 'x' } };
    expect(uploadForm({ ...stored, sig: { kid: 'k', value: 'v' }, mac: { nonce: 'n', value: 'v' }, attest: { owners: [] } })).toEqual({
      ts: '2026-10-27T18:02:13Z',
      created: '2026-10-27T18:02:13.000Z',
      writer: 'm/human',
      seq: 2,
      kind: 'human',
      text: 'hi',
    });
    expect(uploadForm({ ...stored, created: '2026-10-27T18:02:13.000Z' })).not.toBeNull();
    expect(uploadForm({ ...stored, created: '2026-10-27T18:09:00.000Z' })).toBeNull();
  });
});

describe('the signature ledger', () => {
  const sig = (n: number) => ({ hash: `h${n}`, sig: { kid: base64urlEncode(new Uint8Array(16)), value: base64urlEncode(new Uint8Array(64).fill(n)) } });

  it('survives a restart, its reach the highest seq per writer, a torn last line skipped', () => {
    const dir = scratch();
    const ledger = new SignatureLedger(() => dir);
    ledger.put('p1', 'm/human', 1, sig(1));
    ledger.put('p1', 'm/human', 2, sig(2));
    ledger.put('p1', 'm/s', 1, sig(3));
    fs.appendFileSync(join(dir, 'p1.jsonl'), '{"writer":"m/human","seq":3,"hash"');
    const again = new SignatureLedger(() => dir);
    expect(again.get('p1', 'm/human', 2)).toEqual(sig(2));
    expect(again.get('p1', 'm/human', 3)).toBeNull();
    expect(Object.fromEntries(again.reach('p1'))).toEqual({ 'm/human': 2, 'm/s': 1 });
    expect(again.reach('p2').size).toBe(0);
    expect(fs.statSync(join(dir, 'p1.jsonl')).mode & 0o777).toBe(0o600);
  });
});

describe('the inbound index', () => {
  it('holds content at its first position across a restart: the same position is same, another is replayed', () => {
    const dir = scratch();
    let now = Date.parse('2026-10-27T18:00:00.000Z');
    new InboundIndex(() => dir, () => now).record('p1', 'c1', 'hub/b', 1);
    const index = new InboundIndex(() => dir, () => now);
    expect(index.seen('p1', 'c1', 'hub/b', 1)).toEqual({ kind: 'same' });
    expect(index.seen('p1', 'c1', 'hub/b', 3)).toEqual({ kind: 'replayed', writer: 'hub/b', seq: 1 });
    expect(index.seen('p2', 'c1', 'hub/b', 3)).toEqual({ kind: 'new' });
    expect(index.at('p1', 'hub/b', 1)).toBe('c1');
    now += INBOUND_KEPT_MS + 1;
    expect(new InboundIndex(() => dir, () => now).seen('p1', 'c1', 'hub/b', 3)).toEqual({ kind: 'new' });
  });
});

describe('the revocation set', () => {
  it('names a revoked device and member only once the head no longer holds them, and every revoked key', async () => {
    const a1 = await newDevice('a1');
    const b1 = await newDevice('b1');
    const b2 = await newDevice('b2');
    const A = memberId();
    const B = memberId();
    const C = memberId();
    const c1 = await newDevice('c1');
    let head = await genesis('org-u', A, a1, await generateSigningKey());
    head = await successor(head, [a1], (s) => {
      s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device, b2.device] });
      s.members.push({ id: C, email: 'c@example.com', role: 'member', devices: [c1.device] });
    });
    const revokedB1 = await revokedDevice(B, b1.device);
    const revokedC1 = await revokedDevice(C, c1.device);
    head = await successor(head, [a1], (s) => {
      s.members = s.members.filter((m) => m.id !== C);
      s.members.find((m) => m.id === B)!.devices = [b2.device];
      s.revoked.push(...revokedB1, ...revokedC1);
    });
    const set = await revocationSet(head.state, { certs: [], retirements: [] });
    expect(set.version).toBe(3);
    expect(set.devices).toEqual(['b1', 'c1']);
    // B keeps b2: naming B would revoke b2's words too.
    expect(set.members).toEqual([C]);
    expect(set.keys).toEqual([...revokedB1, ...revokedC1].map((r) => r.keyId).sort());
  });
});

describe('the hold', () => {
  const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
  const event = (seq: number) => ({ ts: '2026-10-27T18:00:00.000Z', writer: 'hub/0f1e2d3c4b5a69788796a5b4c3d2e1f0', seq, kind: 'human', text: 'hi' });
  /** A relay with no head yet: every arriving event waits on one. */
  function relay() {
    let now = Date.parse('2026-10-27T18:00:00.000Z');
    const toSminos: Frame[] = [];
    const toHub: Frame[] = [];
    const lines: string[] = [];
    const ctx = {
      org: () => null,
      key: () => null,
      hub: { openProject: () => () => {}, send: (f: Frame) => (toHub.push(f), true) },
      toSminos: (f: Frame) => void toSminos.push(f),
      opened: () => {},
      now: () => now,
      log: (line: string) => void lines.push(line),
    } as unknown as RelayContext;
    const r = new LogRelay(ctx);
    r.hello({ t: 'hello', project: P, name: 'maws', have: {} });
    return { r, toSminos, toHub, lines, later: (ms: number) => (now += ms) };
  }

  it('holds what no head can judge yet: nothing down, nothing rejected, nothing spent; let go once held past HOLD_MS', async () => {
    const { r, toSminos, toHub, lines, later } = relay();
    await r.fromHub({ t: 'events', project: P, events: [event(1), event(2)] });
    expect(r.holding).toBe(2);
    expect(toSminos).toEqual([]);
    expect(toHub).toEqual([]);
    await r.retry();
    expect(r.holding).toBe(2);
    later(HOLD_MS + 1);
    await r.retry();
    expect(r.holding).toBe(0);
    expect(toSminos).toEqual([]);
    expect(toHub).toEqual([]);
    expect(lines.filter((l) => l.includes('let go of'))).toHaveLength(2);
  });

  it('keeps at most HOLD_MAX, the oldest let go first; the same position held once; all gone when sminos goes', async () => {
    const { r } = relay();
    await r.fromHub({ t: 'events', project: P, events: Array.from({ length: HOLD_MAX + 5 }, (_, i) => event(i + 1)) });
    expect(r.holding).toBe(HOLD_MAX);
    await r.fromHub({ t: 'events', project: P, events: [event(HOLD_MAX + 5)] });
    expect(r.holding).toBe(HOLD_MAX);
    r.closeAll();
    expect(r.holding).toBe(0);
  });
});

describe('the socket', () => {
  const handlers = (frames: Frame[]) => ({ hello: () => {}, frame: (_c: unknown, f: Frame) => void frames.push(f), closed: () => {} });

  it('serves 0600 with an rl10.json of 0600 naming it, closes a wrong token with nothing written, and removes both when closed', async () => {
    const dir = scratch();
    const frames: Frame[] = [];
    const server = new Rl10Server({ stateDir: () => dir, build: 'units', handlers: handlers(frames), log: () => {} });
    await server.serve();
    const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string; protocol: number };
    expect(info.socket).toBe(join(dir, 'rl10.sock'));
    expect(info.token).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(join(dir, 'rl10.json')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(info.socket).mode & 0o777).toBe(0o600);

    const stranger = connect(info.socket);
    let written = '';
    stranger.on('data', (chunk) => (written += String(chunk)));
    const closed = new Promise<void>((resolve) => stranger.on('close', () => resolve()));
    stranger.write(`${JSON.stringify({ t: 'hello', token: 'f'.repeat(64) })}\n${JSON.stringify({ t: 'pending' })}\n`);
    await closed;
    expect(written).toBe('');
    expect(frames).toEqual([]);

    await server.close();
    expect(fs.existsSync(join(dir, 'rl10.json'))).toBe(false);
    expect(fs.existsSync(info.socket)).toBe(false);
  });

  it('takes a private directory of its own under the temporary directory when the state directory’s path is too long for a socket', () => {
    const dir = join(scratch(), 'x'.repeat(100));
    const path = socketPath(dir);
    expect(path).not.toContain(dir);
    expect(Buffer.byteLength(path)).toBeLessThanOrEqual(103);
    expect(fs.statSync(join(path, '..')).mode & 0o777).toBe(0o700);
    expect(socketPath(dir)).toBe(path);
    fs.rmSync(join(path, '..'), { recursive: true, force: true });
  });
});

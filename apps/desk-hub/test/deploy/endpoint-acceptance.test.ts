// The endpoint acceptance command's guards and helpers (deploy/endpoint-acceptance.ts, endpoint-production.ts,
// endpoint-remote.ts and vm/stub-model.mjs; P5 O10 M11): which mode a command line asks for and what it refuses, above
// all production; the pacing of the run's own direct dials under the listener's limit; production's pairing answer,
// which prints the device and its fingerprint and never the code; and the stub model's answers by content.
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64urlDecode, decodePairingCode, encodePairingCode, generateSigningKey, keyId, verifyPairingMac, type Device } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { mode } from '../../deploy/endpoint-acceptance.ts';
import { pairRunDevice, productionRun, waitForFile } from '../../deploy/endpoint-production.ts';
import { DirectPacer } from '../../deploy/endpoint-remote.ts';
import { Secrets } from '../../deploy/endpoint-verdicts.ts';
import type { Person } from '../../deploy/hub.ts';
import { Cleanup } from '../../deploy/proof.ts';
import { PRODUCTION_HOST, STAGING_HOST } from '../../deploy/config.ts';

const OWNER = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const staging = { worker: 'desk-hub-staging', host: STAGING_HOST };
const production = { worker: 'desk-hub', host: PRODUCTION_HOST };

describe('the command line’s mode', () => {
  it('runs staging with the admin device’s keys, and refuses it without them', () => {
    expect(mode({ 'device-keys': '/k.json' }, staging)).toEqual({ mode: 'staging' });
    expect(mode({}, staging)).toEqual({ refused: expect.stringMatching(/--device-keys/) });
  });

  it('runs production only when asked by name twice, with production’s own config', () => {
    const both = { production: true, 'confirm-production': PRODUCTION_HOST };
    expect(mode(both, production)).toEqual({ mode: 'production' });
    for (const values of [{ production: true }, { 'confirm-production': PRODUCTION_HOST }, { production: true, 'confirm-production': 'desk-hub.example.workers.dev' }]) {
      expect(mode(values, production), JSON.stringify(values)).toEqual({ refused: expect.stringMatching(/only with --production and --confirm-production/) });
    }
    // The device keys do not stand in for the flags, and the flags do not lead a staging config to production.
    expect(mode({ 'device-keys': '/k.json' }, production)).toEqual({ refused: expect.stringMatching(/names production .* only with --production --confirm-production/) });
    expect(mode(both, staging)).toEqual({ refused: expect.stringMatching(/not production's/) });
  });

  it('sets the VM scene up or tears it down, one at a time and with no hub', () => {
    expect(mode({ 'vm-setup': true }, null)).toEqual({ mode: 'vm-setup' });
    expect(mode({ 'vm-teardown': true }, staging)).toEqual({ mode: 'vm-teardown' });
    expect(mode({ 'vm-setup': true, 'vm-teardown': true }, null)).toEqual({ refused: expect.stringMatching(/one at a time/) });
    expect(mode({ 'vm-setup': true, production: true }, null)).toEqual({ refused: expect.stringMatching(/--production does not go with them/) });
    expect(mode({}, null)).toEqual({ refused: expect.stringMatching(/--config/) });
  });
});

describe('the run’s own direct dials', () => {
  /** A pacer on a clock the test moves: `wait` moves it. */
  const paced = () => {
    let now = 0;
    const waits: number[] = [];
    const pacer = new DirectPacer(3, 13_000, () => now, async (ms) => {
      waits.push(ms);
      now += ms;
    });
    return { pacer, waits, at: () => now, advance: (ms: number) => (now += ms) };
  };

  it('spends the burst at once, then one dial a refill', async () => {
    const { pacer, waits, at } = paced();
    for (let i = 0; i < 3; i++) await pacer.take();
    expect(waits).toEqual([]);
    await pacer.take();
    expect(at()).toBeGreaterThanOrEqual(13_000);
    await pacer.take();
    expect(at()).toBeGreaterThanOrEqual(26_000);
  });

  it('waits out a full refill after the burst was spent outside it', async () => {
    const { pacer, at, advance } = paced();
    advance(100_000);
    pacer.drain();
    await pacer.full();
    expect(at()).toBeGreaterThanOrEqual(100_000 + 3 * 13_000);
  });
});

describe('production’s pairing answer', () => {
  /** A person whose hub answers /api/me, the pending POST (kept) and the head (listing the device after `listAfter` reads). */
  async function hub({ member = OWNER, listAfter = 1 } = {}) {
    const posted: unknown[] = [];
    let reads = 0;
    const person = {
      hub: `https://${PRODUCTION_HOST}`,
      async json(path: string, init: { body?: unknown } = {}) {
        if (path === '/api/me') return { org: { id: 'org-p' }, member: { id: member } };
        if (path === '/api/devices/pending') {
          posted.push(init.body);
          return {};
        }
        if (path === '/api/org/state') {
          const devices = ++reads > listAfter ? posted.map((p) => ({ id: (p as { deviceId: string }).deviceId, channelPub: (p as { channelPub: string }).channelPub })) : [];
          return { head: { state: { members: [{ id: OWNER, devices }] } } };
        }
        throw new Error(`unexpected ${path}`);
      },
    } as unknown as Person;
    const k = crypto.getRandomValues(new Uint8Array(16));
    const recovery = await generateSigningKey();
    const code = encodePairingCode({ hub: `https://${PRODUCTION_HOST}`, org: 'org-p', member: OWNER, roots: [await keyId(recovery.pub)], recoveryPub: recovery.pub, k: Buffer.from(k).toString('base64url') });
    return { person, posted, code };
  }

  it('answers with the device named before, its entry MAC’d under the code’s secret, and prints its fingerprint, never the code', async () => {
    const { person, posted, code } = await hub();
    const lines: string[] = [];
    const secrets = new Secrets();
    const device = await pairRunDevice(person, code, secrets, (line) => lines.push(line), { id: 'o10-p-abc123', approveMs: 30_000 });
    expect(device).toMatchObject({ id: 'o10-p-abc123', member: OWNER, clientClass: 'native-mac' });
    expect(posted).toHaveLength(1);
    const entry = posted[0] as { deviceId: string; class: Device['class']; keyStorage: Device['keyStorage']; channelPub: string; stepUpPub: string; mac: string };
    const { k } = decodePairingCode(code)!;
    const listed: Device = { id: entry.deviceId, class: entry.class, keyStorage: entry.keyStorage, channelPub: entry.channelPub, stepUpPub: entry.stepUpPub };
    expect(await verifyPairingMac(base64urlDecode(k), { org: 'org-p', member: OWNER, device: listed }, entry.mac)).toBe(true);
    expect(lines.join('\n')).toMatch(/approve o10-p-abc123 .* fingerprint is \S+/);
    expect(lines.join('\n')).not.toContain(code);
    expect(lines.join('\n')).not.toContain(k);
    expect(secrets.scrub(`${code} ${k}`)).toBe('<secret> <secret>');
  }, 20_000);

  it('refuses another member’s code before sending anything', async () => {
    const { person, posted, code } = await hub({ member: OTHER });
    await expect(pairRunDevice(person, code, new Secrets(), () => {}, { id: 'o10-p-x' })).rejects.toThrow(/another member’s/);
    expect(posted).toEqual([]);
    await expect(pairRunDevice(person, 'not a code', new Secrets(), () => {}, { id: 'o10-p-x' })).rejects.toThrow(/no pairing code/);
  });

  it('is production’s alone', async () => {
    const person = { hub: `https://${STAGING_HOST}` } as unknown as Person;
    const dir = mkdtempSync(join(tmpdir(), 'o10-prod-'));
    await expect(productionRun({ person, items: ['9'], cleanup: new Cleanup(), secrets: new Secrets(), ssh: { devcloud: '/nonexistent', vm: 'vm' }, scratch: dir, directUrl: 'ws://127.0.0.1:1', log: () => {}, ready: join(dir, 'ready') })).rejects.toThrow(/production's alone/);
  });

  it('waits for the controller’s signal, bounded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'o10-ready-'));
    const file = join(dir, 'ready');
    await expect(waitForFile(file, 1500)).rejects.toThrow(/did not appear within/);
    setTimeout(() => writeFileSync(file, ''), 300);
    await expect(waitForFile(file, 5000)).resolves.toBeUndefined();
  });
});

describe('the lane A session’s stub model', () => {
  async function stub(): Promise<(body: unknown) => { blocks: Array<Record<string, unknown>>; stop: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'o10-stub-'));
    const deploy = join(import.meta.dirname, '../../deploy/vm');
    copyFileSync(join(deploy, 'stub-model.mjs'), join(dir, 'stub-model.mjs'));
    copyFileSync(join(import.meta.dirname, '../../../../spikes/protocol-probe/stub-api.mjs'), join(dir, 'stub-api.mjs'));
    return ((await import(join(dir, 'stub-model.mjs'))) as { answer: (body: unknown) => { blocks: Array<Record<string, unknown>>; stop: string } }).answer;
  }
  const user = (content: unknown) => ({ tools: [{ name: 'Bash' }], messages: [{ role: 'user', content }] });

  it('turns a ticks request into a tool loop of that length, answered by content alone', async () => {
    const answer = await stub();
    const first = answer(user('o10-m11 ticks 3 abc'));
    expect(first.stop).toBe('tool_use');
    expect(first.blocks.at(-1)).toMatchObject({ type: 'tool_use', name: 'Bash', input: { command: 'echo o10-m11 tick 1/3 abc' } });
    const second = answer(user([{ type: 'tool_result', tool_use_id: 'x', content: 'o10-m11 tick 1/3 abc' }]));
    expect(second.blocks.at(-1)).toMatchObject({ input: { command: 'echo o10-m11 tick 2/3 abc' } });
    const done = answer(user([{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'o10-m11 tick 3/3 abc' }] }]));
    expect(done).toEqual({ blocks: [{ type: 'text', text: 'o10-m11 ticks done abc' }], stop: 'end_turn' });
  });

  it('answers anything else with a short text that echoes nothing of it', async () => {
    const answer = await stub();
    const turn = answer(user('o10-m11 words abc-0123456789'));
    expect(turn).toEqual({ blocks: [{ type: 'text', text: 'o10-m11 stub: noted (28 characters)' }], stop: 'end_turn' });
  });
});

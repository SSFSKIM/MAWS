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

describe('the run’s requests to the hub', () => {
  /** A hub that takes every request and never answers it. */
  async function silent(): Promise<{ url: string; close(): void }> {
    const { createServer } = await import('node:http');
    const held: Array<{ destroy(): void }> = [];
    const server = createServer((req) => void held.push(req.socket));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => (held.forEach((s) => s.destroy()), server.close()) };
  }

  it('gives each request a deadline', async () => {
    const hub = await silent();
    const { Person } = await import('../../deploy/hub.ts');
    const person = new Person(hub.url, 'token', () => {}, { requestMs: 500 });
    const started = Date.now();
    await expect(person.json('/api/me')).rejects.toThrow(/GET \/api\/me: no answer within 0.5 s/);
    expect(Date.now() - started).toBeLessThan(3000);
    hub.close();
  });

  it('ends a request in flight when the run is interrupted, but not the cleanup’s after it', async () => {
    const hub = await silent();
    const { Person } = await import('../../deploy/hub.ts');
    const cleanup = new Cleanup();
    const person = new Person(hub.url, 'token', () => cleanup.check(), { requestMs: 60_000, signal: cleanup.signal });
    const asking = person.json('/api/me');
    setTimeout(() => cleanup.interrupt('interrupted by SIGTERM'), 200);
    await expect(asking).rejects.toThrow(/interrupted by SIGTERM/);
    // The cleanup's request is bounded by its deadline alone.
    const bounded = new Person(hub.url, 'token', () => cleanup.check(), { requestMs: 400, signal: cleanup.signal });
    let said = '';
    cleanup.add('read back', async () => {
      await bounded.json('/api/me').catch((error: Error) => void (said = error.message));
    });
    await cleanup.run();
    expect(said).toMatch(/no answer within 0.4 s/);
    hub.close();
  });
});

describe('the owner’s removal of the run’s device', () => {
  const after = (ms: number, value?: string) => new Promise<string>((done) => setTimeout(() => done(value as string), ms));

  it('watches the channel through the owner’s whole wait, its deadline starting only once the removal is seen', async () => {
    const { closeAfterRemoval } = await import('../../deploy/endpoint-items.ts');
    // The owner took longer than the deadline: the close that follows the removal still counts.
    expect(await closeAfterRemoval(after(600, 'removed'), after(500), 300)).toBe('removed');
    // A close the channel saw before the removal was read is kept too.
    expect(await closeAfterRemoval(after(100, 'removed'), after(400), 50)).toBe('removed');
    // No close within the deadline after the removal: still open.
    expect(await closeAfterRemoval(new Promise<string>(() => {}), after(100), 200)).toBe('still open');
  });
});

describe('the late original’s answer', () => {
  it('is the tombstone’s refusal, in sminos’s words or RL4’s', async () => {
    const { isTombstoned } = await import('../../deploy/endpoint-items.ts');
    expect(isTombstoned({ t: 'done', outcome: { state: 'failed', error: { code: 'tombstoned' } } })).toBe(true);
    expect(isTombstoned({ t: 'done', outcome: { state: 'refused', reason: 'tombstoned' } })).toBe(true);
    expect(isTombstoned({ t: 'done', outcome: { state: 'done', result: {} } })).toBe(false);
    expect(isTombstoned({ t: 'done', outcome: { state: 'failed', error: { code: 'internal' } } })).toBe(false);
    expect(isTombstoned({ t: 'ack', outcome: undefined })).toBe(false);
  });
});

describe('production’s allowlist', () => {
  it('runs only the clauses it lists, a hub write only when allowed, and never a hub deploy or an org-state change', async () => {
    const { productionAdmit } = await import('../../deploy/endpoint-items.ts');
    const { ItemReport } = await import('../../deploy/endpoint-verdicts.ts');
    const lines: string[] = [];
    const report = new ItemReport(['2', '3', '5', '9'], (line) => lines.push(line));
    report.admit = productionAdmit(false);
    const ran: string[] = [];
    const run = (name: string) => async () => (ran.push(name), 'ran');
    await report.check('9', 'the handshake and caps over the direct carrier', run('caps'));
    await report.check('9', 'a revoked device refused, and one a new state removes closed `removed`, over both carriers', run('revoked'));
    await report.check('2', 'a hub deploy, then the forced cut: the relayed channel resumes by replay', run('deploy'));
    await report.check('5', 'a device’s words arrive verified and are delivered into the session', run('words'));
    await report.check('3', 'a clause nobody listed', run('unlisted'));
    expect(ran).toEqual(['caps']);
    expect(lines).toEqual([
      'ok   9 the handshake and caps over the direct carrier: ran',
      'skip 9 a revoked device refused, and one a new state removes closed `removed`, over both carriers: never in production: the run amends no org state there',
      'skip 2 a hub deploy, then the forced cut: the relayed channel resumes by replay: never in production: no hub deploy',
      'skip 5 a device’s words arrive verified and are delivered into the session: writes the production hub’s stored data, which this run is not allowed',
      'skip 3 a clause nobody listed: not on production’s allowlist',
    ]);
    report.admit = productionAdmit(true);
    await report.check('5', 'a device’s words arrive verified and are delivered into the session', run('words'));
    expect(ran).toEqual(['caps', 'words']);
  });

  it('names only clauses the items have', async () => {
    const { PRODUCTION_CLAUSES } = await import('../../deploy/endpoint-items.ts');
    const source = (await import('node:fs')).readFileSync(join(import.meta.dirname, '../../deploy/endpoint-items.ts'), 'utf8');
    const names = new Set<string>();
    for (const m of source.matchAll(/report\.check\('(\d)', (`[^`]*`|'[^']*')/g)) {
      const raw = m[2].slice(1, -1);
      for (const carrier of raw.includes('${') ? ['relayed', 'direct'] : ['']) names.add(`${m[1]} ${raw.replace(/\$\{(track\.)?carrier\}/g, carrier)}`);
    }
    for (const clause of Object.keys(PRODUCTION_CLAUSES)) expect(names, clause).toContain(clause);
  });
});

describe('the run’s writes to the hub’s stored data', () => {
  it('in production: five marked events at most, in the machine’s own project alone, each kept as residue', async () => {
    const { HubWrites } = await import('../../deploy/endpoint-items.ts');
    const writes = HubWrites.production('proj-machine');
    const ack = (seq: number) => ({ t: 'human-ack', writer: 'hub/mem', seq, offset: seq, nonce: `n${seq}` });
    expect(() => writes.admit('proj-other', 'o10 m11 acceptance words t-1')).toThrow(/only in the machine’s project proj-machine/);
    expect(() => writes.admit('proj-machine', 'hello there')).toThrow(/marked `o10 m11 acceptance`/);
    for (let i = 1; i <= 5; i++) {
      writes.admit('proj-machine', `o10 m11 acceptance words t-${i}`);
      writes.posted('proj-machine', ack(i));
    }
    expect(() => writes.admit('proj-machine', 'o10 m11 acceptance words t-6')).toThrow(/at most 5 events/);
    expect(writes.kept()).toEqual(['the project proj-machine on the hub, and in it the run’s events hub/mem:1, hub/mem:2, hub/mem:3, hub/mem:4, hub/mem:5']);
  });

  it('counts an event the hub refused against the limit too, since it may still have been stored', async () => {
    const { HubWrites } = await import('../../deploy/endpoint-items.ts');
    const writes = HubWrites.production('p', 2);
    writes.admit('p', 'o10 m11 acceptance a x-1');
    writes.admit('p', 'o10 m11 acceptance b x-2');
    expect(() => writes.admit('p', 'o10 m11 acceptance c x-3')).toThrow(/at most 2 events/);
  });

  it('on staging: any project, no limit, the project still kept', async () => {
    const { HubWrites } = await import('../../deploy/endpoint-items.ts');
    const writes = HubWrites.staging('proj-s');
    for (let i = 0; i < 8; i++) writes.admit('proj-s', `o10 m11 acceptance w x-${i}`);
    expect(writes.kept()).toEqual(['the project proj-s on the hub, and in it the run’s events (none acknowledged)']);
  });
});

describe('the read-back after the cleanup', () => {
  it('looks for every device the run added by its id, whatever its prefix, in the head the hub serves then', async () => {
    const { afterEndpointCleanup } = await import('../../deploy/endpoint-acceptance.ts');
    const person = {
      async json(path: string) {
        if (path === '/api/org/state') return { head: { state: { members: [{ id: OWNER, email: 'o@x', devices: [{ id: 'a1' }, { id: 'o10-o2-abc123' }] }], machines: [] } } };
        if (path === '/api/machines') return { machines: [] };
        throw new Error(path);
      },
    } as unknown as Person;
    const left = await afterEndpointCleanup(person, { machines: [], members: [], devices: ['o10-s-abc123-b1', 'o10-o2-abc123'], kept: [] });
    expect(left).toEqual(['the state still lists the device o10-o2-abc123']);
  });
});

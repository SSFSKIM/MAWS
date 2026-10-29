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
    await report.check('3', 'an action resent under a used nonce is refused `replayed`', run('caps'));
    await report.check('3', 'a device a new org state removes is refused at once', run('revoked'));
    await report.check('2', 'a hub deploy, then the forced cut: the relayed channel resumes by replay', run('deploy'));
    await report.check('5', 'a device’s words arrive verified and are delivered into the session', run('words'));
    await report.check('3', 'a clause nobody listed', run('unlisted'));
    expect(ran).toEqual(['caps']);
    expect(lines).toEqual([
      'ok   3 an action resent under a used nonce is refused `replayed`: ran',
      'skip 3 a device a new org state removes is refused at once: never in production: the run amends no org state there',
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

describe('item 2’s rows flowing', () => {
  it('counts what arrives from the moment new rows are asked for, so a replay that caught up meanwhile is not a stall', async () => {
    const { flowingAfter } = await import('../../deploy/endpoint-items.ts');
    let events = 10;
    const track = { carrier: 'relayed', count: () => events };
    // The new stretch's rows land while it is being asked for (a fast stub), and none after: progress all the same.
    expect(await flowingAfter(async () => void (events += 3), [track], 'after the replay', 1500)).toBeUndefined();
    // Nothing new at all is a stall.
    await expect(flowingAfter(async () => {}, [track], 'after the replay', 600)).rejects.toThrow(/relayed events after the replay/);
  });
});

describe('item 2’s deploy watcher', () => {
  it('holds a failed resume as its answer instead of rejecting while the deploy still runs', async () => {
    const { watchDuring } = await import('../../deploy/endpoint-items.ts');
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listen);
    try {
      const watched = watchDuring(async () => {
        throw new Error('the resume was refused');
      });
      await new Promise((r) => setTimeout(r, 50)); // the deploy, still running
      expect(unhandled).toEqual([]);
      await expect(watched.join()).rejects.toThrow(/the resume was refused/);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });
});

describe('production’s spawn probes', () => {
  it('runs no spawn the real daemon could launch if its refusal broke: staging and the suite show those refusals', async () => {
    const { productionAdmit } = await import('../../deploy/endpoint-items.ts');
    const admit = productionAdmit(true);
    for (const [item, check] of [
      ['4', 'a spawn whose permission mode is above the ceiling is refused `ceiling`'],
      ['4', 'a spawn into a directory that is no known checkout is refused `unknown-checkout`'],
    ]) expect(admit(item, check), check).toMatch(/^never in production: .*launch a seat.*staging.*test\/endpoint\/grades\.test\.ts/);
    for (const check of ['an owner’s spawn needs step-up', 'a spawn by a member without the machine’s `spawn` right']) expect(admit('8', check), check).toMatch(/^never in production: item 8/);
    // The guarded local spawn still runs.
    expect(admit('4', 'a local `sminos spawn` from the machine runs, untouched by the endpoint')).toBeNull();
  });
});

describe('production’s machine', () => {
  const pinned = { enrollment: 'org-listed', name: 'dc-acceptance-7f80', ref: '7872ff6c6ff6a58065ae0a68160b5dcb_AyQ4IqKLwVJ95-o2oc4zTA' };

  it('is the one the owner authorized, by its VM, its name and its ref, or the run refuses it', async () => {
    const { checkProductionMachine, PRODUCTION_MACHINE } = await import('../../deploy/endpoint-production.ts');
    expect(PRODUCTION_MACHINE).toEqual({ vm: 'dc-acceptance-7f80', name: 'dc-acceptance-7f80', ref: pinned.ref });
    expect(() => checkProductionMachine('dc-acceptance-7f80', pinned)).not.toThrow();
    expect(() => checkProductionMachine('dc-other', pinned)).toThrow(/dc-acceptance-7f80/);
    expect(() => checkProductionMachine('dc-acceptance-7f80', { ...pinned, name: 'macbook' })).toThrow(/macbook/);
    expect(() => checkProductionMachine('dc-acceptance-7f80', { ...pinned, ref: 'other_ref' })).toThrow(/other_ref/);
    expect(() => checkProductionMachine('dc-acceptance-7f80', { ...pinned, enrollment: 'hub-confirmed' })).toThrow(/org-listed/);
  });

  it('is refused before anything is asked of the VM or the owner when the VM is another', async () => {
    const { productionRun } = await import('../../deploy/endpoint-production.ts');
    const { Cleanup } = await import('../../deploy/proof.ts');
    const said: string[] = [];
    const person = { hub: 'https://desk-hub.opencognita-platform.workers.dev' } as unknown as Person;
    await expect(
      productionRun({ person, items: ['9'], cleanup: new Cleanup(), secrets: new Secrets(null), ssh: { devcloud: '/nonexistent', vm: 'dc-other' }, scratch: mkdtempSync(join(tmpdir(), 'ep-pin-')), directUrl: 'ws://100.116.205.27:47830', log: (l) => said.push(l), ready: '/nonexistent' }),
    ).rejects.toThrow(/dc-acceptance-7f80/);
    expect(said).toEqual([]);
  });

  it('is dialled directly at production’s own port unless the command names another address', async () => {
    const { directUrlFor } = await import('../../deploy/endpoint-acceptance.ts');
    expect(directUrlFor('production', undefined)).toBe('ws://100.116.205.27:47830');
    expect(directUrlFor('staging', undefined)).toBe('ws://100.116.205.27:47831');
    expect(directUrlFor('production', 'ws://100.64.0.9:47830')).toBe('ws://100.64.0.9:47830');
  });
});

describe('the machine’s own events, this run’s', () => {
  const log = [
    { offset: 4, event: { writer: 'dc-acceptance-7f80/old', seq: 9 } },
    { offset: 11, event: { writer: 'hub/member-1', seq: 3 } },
    { offset: 12, event: { writer: 'dc-acceptance-7f80/s1', seq: 1 } },
    { offset: 13, event: { writer: 'dc-acceptance-7f80/s1', seq: 2 } },
    { offset: 15, event: { writer: 'dc-acceptance-7f80/s2', seq: 1 } },
    { offset: 16, event: { writer: 'dc-acceptance-7f80-twin/s1', seq: 1 } },
  ];

  it('are the run’s two sessions’ events after the log stood where it did before lane A started: nothing earlier, no other session’s', async () => {
    const { runOwnEvents } = await import('../../deploy/endpoint-items.ts');
    const withOther = [...log, { offset: 14, event: { writer: 'dc-acceptance-7f80/owners-own-session', seq: 7 } }];
    expect(runOwnEvents(withOther, 10, 'dc-acceptance-7f80', ['s1', 's2']).map((e) => e.offset)).toEqual([12, 13, 15]);
    expect(runOwnEvents(withOther, 10, 'dc-acceptance-7f80', ['s1']).map((e) => e.offset)).toEqual([12, 13]);
    expect(runOwnEvents(withOther, 15, 'dc-acceptance-7f80', ['s1', 's2'])).toEqual([]);
  });

  it('are kept as residue by writer, apart from the run’s marked events', async () => {
    const { runOwnEvents, sessionResidue } = await import('../../deploy/endpoint-items.ts');
    expect(sessionResidue('proj-m', 10, runOwnEvents(log, 10, 'dc-acceptance-7f80', ['s1', 's2']))).toBe(
      'the machine’s own events in the project proj-m after offset 10, written by the run’s sessions (lane A, the spawn): dc-acceptance-7f80/s1 2 (offsets 12–13), dc-acceptance-7f80/s2 1 (offset 15)',
    );
    expect(sessionResidue('proj-m', 10, [])).toBe('the machine’s own events in the project proj-m after offset 10, written by the run’s sessions (lane A, the spawn): none');
  });
});

describe('the run’s channel, as a device holds one', () => {
  it('answers the endpoint’s ping with a pong, so a channel the run is quiet on is not closed `timeout`', async () => {
    const { Remote } = await import('../../deploy/endpoint-remote.ts');
    let deliver: (m: unknown) => void = () => {};
    const sent: unknown[] = [];
    const channel = { onMessage: (f: (m: unknown) => void) => void (deliver = f), onClose: () => {}, send: async (m: unknown) => void sent.push(m) };
    const remote = new Remote({} as never, channel as never);
    deliver({ t: 'ping', at: 1234 });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([{ t: 'pong', at: 1234 }]);
    expect(remote.inbox).toEqual([{ t: 'ping', at: 1234 }]);
  });
});

describe('the hub deploy item 2 runs', () => {
  it('runs outside the package script the run itself is (pnpm refuses a nested `--filter` run inside one)', async () => {
    const { hubDeployEnv } = await import('../../deploy/endpoint-acceptance.ts');
    const env = hubDeployEnv({ HOME: '/h', PATH: '/bin', PNPM_SCRIPT_SRC_DIR: '/w/apps/desk-hub', npm_lifecycle_event: 'deployment', npm_package_name: 'desk-hub', pnpm_config_verify_deps_before_run: 'false', DESK_STAGING_DEVICE: '/d' });
    expect(env).toEqual({ HOME: '/h', PATH: '/bin', DESK_STAGING_DEVICE: '/d' });
  });
});

describe('lane A’s project', () => {
  it('is the machine’s own on production (its one writable project), and one of the run’s on staging, whose checkouts sminos lists', async () => {
    const { laneAProject } = await import('../../deploy/endpoint-acceptance.ts');
    const { machineProjectId } = await import('../../src/protocol/identity.ts');
    expect(laneAProject('production', 'org-1', 'dc-acceptance-7f80')).toEqual({ id: machineProjectId('org-1', 'dc-acceptance-7f80'), name: 'dc-acceptance-7f80' });
    const staging = laneAProject('staging', 'org-1', 'o10-m11-abc123');
    expect(staging.name).toBe('o10-m11-abc123');
    expect(staging.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(staging.id).not.toBe(machineProjectId('org-1', 'o10-m11-abc123'));
  });
});

describe('production’s gate and remote spawns', () => {
  it('admits no clause that submits a `sminos.spawn` to the machine', async () => {
    const { productionAdmit } = await import('../../deploy/endpoint-items.ts');
    const source = (await import('node:fs')).readFileSync(join(import.meta.dirname, '../../deploy/endpoint-items.ts'), 'utf8');
    const admit = productionAdmit(true);
    const spawning: string[] = [];
    const parts = source.split(/(?=report\.check\(')/);
    for (const part of parts) {
      const m = /^report\.check\('(\d)', ('[^']*'|`[^`]*`)/.exec(part);
      if (m === null) continue;
      // The clause's body: up to the next clause, a sibling clause's code at most.
      if (!/action: 'sminos\.spawn'/.test(part)) continue;
      spawning.push(`${m[1]} ${m[2].slice(1, -1)}`);
    }
    expect(spawning.length).toBeGreaterThan(3);
    for (const clause of spawning) expect(admit(clause.slice(0, 1), clause.slice(2)), clause).not.toBeNull();
  });
});

describe('the seat a local spawn made', () => {
  it('is the session `sminos spawn` printed, or none', async () => {
    const { seatSession } = await import('../../deploy/endpoint-items.ts');
    expect(seatSession(['banner', 'seat spawned: proj/o10-local-ab12cd  [4f2a9c1 / 0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13]  status=working  (reply: sminos reply 4f2a9c1)'])).toBe('0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13');
    expect(seatSession(['sminos: spawn failed'])).toBeNull();
  });
});

describe('production’s items', () => {
  it('are 2–5 when none are named, and a selection outside them is refused', async () => {
    const { itemsFor } = await import('../../deploy/endpoint-acceptance.ts');
    expect(itemsFor('production', undefined)).toEqual({ items: ['2', '3', '4', '5'] });
    expect(itemsFor('production', '8')).toEqual({ refused: expect.stringMatching(/production runs items 2,3,4,5 alone/) });
    expect(itemsFor('production', '2,9')).toEqual({ refused: expect.stringMatching(/production runs items 2,3,4,5 alone/) });
    expect(itemsFor('production', '3,5')).toEqual({ items: ['3', '5'] });
    expect(itemsFor('staging', undefined)).toEqual({ items: ['2', '3', '4', '5', '8', '9', '10'] });
    expect(itemsFor('production', '10')).toEqual({ refused: expect.stringMatching(/production runs items 2,3,4,5 alone/) });
    expect(itemsFor('staging', '8')).toEqual({ items: ['8'] });
    expect(itemsFor('staging', '7')).toEqual({ refused: expect.stringMatching(/--items names items among/) });
  });

  it('never admit a clause of item 8 or 9 on production, the not-offered probe included', async () => {
    const { productionAdmit, PRODUCTION_CLAUSES } = await import('../../deploy/endpoint-items.ts');
    expect(Object.keys(PRODUCTION_CLAUSES).filter((c) => /^[89] /.test(c))).toEqual([]);
    const admit = productionAdmit(true);
    expect(admit('8', 'what production’s offer table doesn’t offer is refused `not-offered`, the owner’s too')).not.toBeNull();
    expect(admit('9', 'the handshake and caps over the direct carrier')).not.toBeNull();
  });
});

describe('item 3’s relays, bound to the action’s own sealed frame', () => {
  /** A channel stand-in that writes each message's bytes to its carrier after a delay, one write at a time, as
   * Channel.write seals and writes in its queue's order. */
  function slowChannel(carrier: { send(b: Uint8Array): void }, sealMs = 20) {
    let deliver: (m: unknown) => void = () => {};
    let queue = Promise.resolve();
    const channel = {
      onMessage: (f: (m: unknown) => void) => void (deliver = f),
      onClose: () => {},
      send: (m: unknown) => {
        const run = queue.then(async () => {
          await new Promise((r) => setTimeout(r, sealMs));
          carrier.send(Buffer.from(JSON.stringify(m)));
        });
        queue = run.catch(() => {});
        return run;
      },
    };
    return { channel, deliver: (m: unknown) => deliver(m) };
  }
  const text = (b: Uint8Array) => Buffer.from(b).toString();

  it('replays the action’s frame, never a pong queued before it', async () => {
    const { FrameRelay, Remote } = await import('../../deploy/endpoint-remote.ts');
    const out: string[] = [];
    const relay = new FrameRelay({ send: (b: Uint8Array) => void out.push(text(b)), onBytes: () => {}, onClose: () => {}, close: () => {} } as never);
    const { channel, deliver } = slowChannel(relay.device);
    const remote = new Remote({} as never, channel as never);
    deliver({ t: 'ping', at: 1 }); // its pong queued in the channel's writes, not yet on the carrier
    const act = await remote.sendCaptured({ t: 'act', action: { opId: 'op-1' } } as never, relay);
    expect(text(act)).toBe('{"t":"act","action":{"opId":"op-1"}}');
    relay.inject(act);
    expect(out).toEqual(['{"t":"pong","at":1}', '{"t":"act","action":{"opId":"op-1"}}', '{"t":"act","action":{"opId":"op-1"}}']);
  });

  it('alters the action’s frame by its bytes, a pong queued before it passed untouched', async () => {
    const { FrameRelay, Remote } = await import('../../deploy/endpoint-remote.ts');
    const out: Uint8Array[] = [];
    const relay = new FrameRelay({ send: (b: Uint8Array) => void out.push(b), onBytes: () => {}, onClose: () => {}, close: () => {} } as never);
    const { channel, deliver } = slowChannel(relay.device);
    const remote = new Remote({} as never, channel as never);
    deliver({ t: 'ping', at: 2 });
    relay.hold();
    const act = await remote.sendCaptured({ t: 'act', action: { opId: 'op-2' } } as never, relay);
    relay.release(act);
    expect(out.map(text)[0]).toBe('{"t":"pong","at":2}');
    expect(out).toHaveLength(2);
    expect(text(out[1])).not.toBe(text(act));
    expect(out[1].length).toBe(act.length);
  });

  it('keeps answering pings while a slow action waits for its done: nothing is held past the action’s own write', async () => {
    const { FrameRelay, Remote } = await import('../../deploy/endpoint-remote.ts');
    const out: string[] = [];
    const relay = new FrameRelay({ send: (b: Uint8Array) => void out.push(text(b)), onBytes: () => {}, onClose: () => {}, close: () => {} } as never);
    const { channel, deliver } = slowChannel(relay.device, 5);
    const remote = new Remote({} as never, channel as never);
    await remote.sendCaptured({ t: 'act', action: { opId: 'op-3' } } as never, relay);
    for (const at of [10, 11, 12]) deliver({ t: 'ping', at });
    await new Promise((r) => setTimeout(r, 60));
    expect(out).toEqual(['{"t":"act","action":{"opId":"op-3"}}', '{"t":"pong","at":10}', '{"t":"pong","at":11}', '{"t":"pong","at":12}']);
  });
});

describe('the sessions the run started', () => {
  it('count a seat the production guard stopped, from the spawn’s own words', async () => {
    const { recordSeat } = await import('../../deploy/endpoint-items.ts');
    const sessions = ['lane-a'];
    const guarded = ['before the spawn: no claude of new’s but the run’s own', 'seat spawned: p/o10-local-x  [4f2a9c1 / 0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13]  status=working  (reply: sminos reply 4f2a9c1)', 'seat pid 301: CLAUDE_CONFIG_DIR=/Users/new/.claude', 'the seat was stopped at once: kill 301'];
    recordSeat(sessions, guarded);
    recordSeat(sessions, guarded);
    expect(sessions).toEqual(['lane-a', '0f3e8a52-7c1d-4b9e-9a61-2d4f6b8c0e13']);
  });

  it('are merged with what the VM recorded, a lane A whose start failed after its id was chosen included', async () => {
    const { mergeSessions } = await import('../../deploy/endpoint-acceptance.ts');
    const sessions = ['a'];
    mergeSessions(sessions, ['a', 'b', 'c']);
    expect(sessions).toEqual(['a', 'b', 'c']);
  });
});

describe('a lost acknowledgement', () => {
  it('is the op’s own ack and done kept from the run, by their content: a ping before them still passes and is answered', async () => {
    const { Remote } = await import('../../deploy/endpoint-remote.ts');
    let deliver: (m: unknown) => void = () => {};
    const sent: unknown[] = [];
    const channel = { onMessage: (f: (m: unknown) => void) => void (deliver = f), onClose: () => {}, send: async (m: unknown) => void sent.push(m) };
    const remote = new Remote({} as never, channel as never);
    const lost = remote.dropIncoming((m) => m.opId === 'op-1' && (m.t === 'ack' || m.t === 'done' || m.t === 'result'));
    deliver({ t: 'ping', at: 5 });
    deliver({ t: 'ack', opId: 'op-1', state: 'accepted' });
    deliver({ t: 'ack', opId: 'op-2', state: 'accepted' });
    deliver({ t: 'done', opId: 'op-1', outcome: { state: 'done' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(remote.inbox).toEqual([{ t: 'ping', at: 5 }, { t: 'ack', opId: 'op-2', state: 'accepted' }]);
    expect(sent).toEqual([{ t: 'pong', at: 5 }]);
    expect(lost.dropped.map((m) => m.t)).toEqual(['ack', 'done']);
  });
});

describe('the endpoint ready for the run', () => {
  const status = { enrollment: 'org-listed', hub: { connected: true }, listener: { bound: true }, stateVersion: 5, channels: { relayed: 0, direct: 0 }, rl10: { connected: true } } as const;

  it('is org-listed, on the hub, at the head, and bound: by its status, or by the sockets it listens on when its status flag is stale (#320)', async () => {
    const { endpointReady } = await import('../../deploy/endpoint-acceptance.ts');
    expect(endpointReady(status as never, 5, [])).toBe('bound');
    expect(endpointReady({ ...status, listener: { bound: false } } as never, 5, ['100.116.205.27:47830'])).toBe('bound by its sockets (its status says unbound)');
    expect(endpointReady({ ...status, listener: { bound: false } } as never, 5, [])).toBeNull();
    expect(endpointReady({ ...status, stateVersion: 4 } as never, 5, [])).toBeNull();
    expect(endpointReady({ ...status, hub: { connected: false } } as never, 5, [])).toBeNull();
  });
});

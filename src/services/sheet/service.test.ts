// The sheet's service on the spine (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §C, §D, §E; M2):
// records under the sminos home followed and announced, the index's join followed, the writer's door found only when
// there is something to answer and run through the stand-in (test/support/fake-sminos-cli.mjs), and bodies and uploads
// confined to the record. Every rule holds called on the service itself, as C4's page calls it (`SpineRoot.sheet`), and
// through the wire's handlers (`registerSheet`).
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { HandlerContext } from '@shared/ipc/client';
import type { SheetLine, SheetSummary } from '@shared/sheet/model';
import { FAKE_SMINOS, SHEET_FIXTURES, seedRecord } from '../../../test/support/sheet-records';
import { COMMAND_BUDGETS_MS } from '../command-budgets';
import { recordIo, type RecordIo } from './reader';
import { SHEET_TIMING } from './timing';
import { createSheetService, registerSheet, type SheetService, type SheetServiceDeps } from './service';

const scratch: string[] = [];
const services: SheetService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-sheet-service-'));
  scratch.push(dir);
  return dir;
};

const PNG = Buffer.from(readFileSync(join(SHEET_FIXTURES, 'answer-applied/before/sheet/5eed0000-0000-4000-8000-000000000002/uploads/sketch.png')));
const TWO = '5eed0000-0000-4000-8000-000000000004'; // two-surfaces: q1 open, nothing queued once seeded
const REFS = '5eed0000-0000-4000-8000-000000000019'; // references: three captured files
const OTHER = '5eed0000-0000-4000-8000-0000000000ff';
const APP = 'app-1' as AppSessionId;

type Facts = { appSessionId: AppSessionId; title: string | null; live: boolean } | null;

// A service over a scratch home, MAWS_SMINOS_CLI naming the stand-in, the index a table the test moves.
// `timing`: the tests' fast timing unless the test names its own, or 'production' for the service's own.
function start(options: { named?: string | null; io?: RecordIo; locate?: SheetServiceDeps['locate']; configHome?: string; timing?: SheetServiceDeps['timing'] | 'production' } = {}) {
  const home = tempDir();
  const ran = join(tempDir(), 'ran');
  const sessions = new Map<string, Facts>();
  const indexListeners = new Set<() => void>();
  const emitted: { session: string; summary: SheetSummary | null }[] = [];
  const env: Record<string, string> = options.named === null ? {} : { MAWS_SMINOS_CLI: options.named ?? FAKE_SMINOS };
  const service = createSheetService({
    home: Promise.resolve(home),
    shell: Promise.resolve({ PATH: process.env.PATH ?? '', FAKE_SMINOS_RAN: ran }),
    env,
    configHome: Promise.resolve(options.configHome ?? join(home, 'no-config')),
    sessionOf: (id) => sessions.get(id) ?? null,
    onSessionsChanged: (listener) => {
      indexListeners.add(listener);
      return () => indexListeners.delete(listener);
    },
    emit: (_name, payload) => void emitted.push(payload),
    ...(options.timing === 'production' ? {} : { timing: { pollMs: 40, debounceMs: 10, putMs: 10_000, ...options.timing } }),
    ...(options.io === undefined ? {} : { io: options.io }),
    ...(options.locate === undefined ? {} : { locate: options.locate }),
  });
  services.push(service);
  return {
    home,
    service,
    emitted,
    sessions,
    indexMoved: () => indexListeners.forEach((listener) => listener()),
    ran: (): string[] => (existsSync(ran) ? readFileSync(ran, 'utf8').split('\n').filter(Boolean) : []),
    record: (session: string) => join(home, 'sheet', session),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The stand-in behind a shell that holds its probe (`sheet show`) or its put this many seconds first; 'hang' holds the
// probe until it is killed. The wait holds no pipe of the command's, so a kill at the timeout is answered at once.
function slowDoor(hold: { show?: number | 'hang'; put?: number }): string {
  const cli = join(tempDir(), 'sminos');
  const wait = (seconds: number | 'hang' | undefined) => (seconds === undefined ? ':' : seconds === 'hang' ? 'exec sleep 30' : `sleep ${seconds} </dev/null >/dev/null 2>&1`);
  writeFileSync(cli, `#!/bin/sh\ncase "$2" in\n  show) ${wait(hold.show)} ;;\n  put) ${wait(hold.put)} ;;\nesac\nexec "${FAKE_SMINOS}" "$@"\n`);
  chmodSync(cli, 0o755);
  return cli;
}
const of = (emitted: { session: string; summary: SheetSummary | null }[], session: string) => emitted.filter((e) => e.session === session);
const answer = (key: string, picks: string[], by: SheetLine['by'] = 'maws'): SheetLine => ({ v: 1, key, kind: 'answer', id: 'q1', revision: 1, picks, by });

describe('following records', () => {
  it('announces a record that appears, an inbox that grows and a record that goes, each once', async () => {
    const t = start();
    expect(await t.service.list()).toEqual([]);
    seedRecord(t.home, 'two-surfaces');
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(1));
    expect(of(t.emitted, TWO)[0]!.summary).toMatchObject({ session: TWO, appSessionId: null, open: 1, queued: 0, unreadable: false });
    expect(await t.service.list()).toEqual([of(t.emitted, TWO)[0]!.summary]);

    appendFileSync(join(t.record(TWO), 'inbox.jsonl'), `${JSON.stringify({ ...answer('cli-00000001', ['Yes'], 'cli'), at: '2026-11-23T10:00:00.000Z' })}\n`);
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(2));
    expect(of(t.emitted, TWO)[1]!.summary).toMatchObject({ open: 0, queued: 1 });

    rmSync(t.record(TWO), { recursive: true });
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(3));
    expect(of(t.emitted, TWO)[2]!.summary).toBeNull();
    await sleep(200); // several polls: nothing more
    expect(of(t.emitted, TWO)).toHaveLength(3);
    expect(await t.service.list()).toEqual([]);
  });

  it('notices the sheet root’s creation within a second, at the service’s own timing', async () => {
    const t = start({ timing: 'production' });
    expect(await t.service.list()).toEqual([]); // the home has no sheet/ yet
    await sleep(300);
    const seeded = Date.now();
    seedRecord(t.home, 'two-surfaces');
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(1), { timeout: 3000, interval: 10 });
    expect(Date.now() - seeded).toBeLessThan(1000);
  });

  it('announces an inbox that shrinks, a door’s rollback, like one that grows', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    const inbox = join(t.record(TWO), 'inbox.jsonl');
    appendFileSync(inbox, `${JSON.stringify({ ...answer('cli-00000001', ['Yes'], 'cli'), at: '2026-11-23T10:00:00.000Z' })}\n`);
    await vi.waitFor(() => expect(of(t.emitted, TWO).at(-1)?.summary).toMatchObject({ queued: 1 }));
    writeFileSync(inbox, '');
    await vi.waitFor(() => expect(of(t.emitted, TWO).at(-1)?.summary).toMatchObject({ queued: 0, open: 1 }));
  });

  it('keeps the last verified model when a read cannot pair, announces nothing, and reads again', async () => {
    let moving = false;
    let reads = 0;
    let seq = 100;
    const io: RecordIo = {
      ...recordIo,
      async readState(path) {
        reads += 1;
        const state = (await recordIo.readState(path)) as { seq: number };
        return moving ? { ...state, seq: (seq += 1) } : state;
      },
    };
    const t = start({ io });
    seedRecord(t.home, 'two-surfaces');
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(1));
    const model = await t.service.read(TWO);
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(2)); // the read's probe found the door: announced
    moving = true;
    appendFileSync(join(t.record(TWO), 'inbox.jsonl'), `${JSON.stringify({ ...answer('cli-00000001', ['Yes'], 'cli'), at: '2026-11-23T10:00:00.000Z' })}\n`);
    const before = reads;
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(before + 16)); // two busy reads of eight
    expect(of(t.emitted, TWO)).toHaveLength(2);
    expect(await t.service.read(TWO)).toEqual(model); // busy again: the last verified model
    moving = false;
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(3)); // read again at a later tick, with no file event
    expect(of(t.emitted, TWO)[2]!.summary).toMatchObject({ queued: 1 });
  });

  it('summarises a record this build cannot read as unreadable, and reads no model of it', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    const state = join(t.record(TWO), 'state.json');
    writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, 'utf8')), v: 2 }));
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(1));
    expect(of(t.emitted, TWO)[0]!.summary).toMatchObject({ unreadable: true, open: 0 });
    expect(await t.service.read(TWO)).toBeNull();
  });
});

describe('following the index', () => {
  it('joins a record found before the index held its session when the index gains it, and hands a listener what it was', async () => {
    const t = start();
    const heard: [SheetSummary | null, string, SheetSummary | null][] = [];
    t.service.onChange((summary, session, was) => void heard.push([summary, session, was]));
    seedRecord(t.home, 'two-surfaces');
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    expect(heard[0]![0]).toMatchObject({ appSessionId: null, live: null, title: null });

    t.sessions.set(TWO, { appSessionId: APP, title: 'Auth work', live: true });
    t.indexMoved();
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    expect(heard[1]![0]).toMatchObject({ appSessionId: APP, live: true, title: 'Auth work' });
    expect(heard[1]![2]).toMatchObject({ appSessionId: null });
    expect(of(t.emitted, TWO).at(-1)!.summary).toMatchObject({ appSessionId: APP });

    // the holder exits; not one byte of the record moves
    const stateBefore = readFileSync(join(t.record(TWO), 'state.json'));
    t.sessions.set(TWO, { appSessionId: APP, title: 'Auth work', live: false });
    t.indexMoved();
    await vi.waitFor(() => expect(heard).toHaveLength(3));
    expect(heard[2]![0]).toMatchObject({ appSessionId: APP, live: false });
    expect(readFileSync(join(t.record(TWO), 'state.json'))).toEqual(stateBefore);

    // removed from the index
    t.sessions.delete(TWO);
    t.indexMoved();
    await vi.waitFor(() => expect(heard).toHaveLength(4));
    expect(heard[3]![0]).toMatchObject({ appSessionId: null, live: null });
    expect(heard[3]![2]).toMatchObject({ appSessionId: APP });

    t.indexMoved(); // nothing of it moved: nothing said
    await sleep(100);
    expect(heard).toHaveLength(4);
  });
});

describe('when the door is found', () => {
  it('starts no process at a list or with no record, and does at the first read of a record with an open question', async () => {
    const t = start();
    expect(t.service.door()).toEqual({ known: false });
    await t.service.list();
    expect(await t.service.read(TWO)).toBeNull(); // no record yet
    expect(t.ran()).toEqual([]);
    seedRecord(t.home, 'two-surfaces');
    await vi.waitFor(async () => expect(await t.service.list()).toHaveLength(1));
    expect(t.ran()).toEqual([]);
    expect(t.service.door()).toEqual({ known: false });
    expect(await t.service.read(TWO)).toMatchObject({ session: TWO, open: [expect.objectContaining({ id: 'q1' })] });
    await vi.waitFor(() => expect(t.service.door()).toEqual({ known: true, available: true }));
    expect(t.ran()).toEqual([FAKE_SMINOS]); // the probe
    await t.service.read(TWO);
    expect(t.ran()).toHaveLength(1);
  });

  it('starts no process at the read of a record with nothing open on it', async () => {
    const t = start();
    const session = seedRecord(t.home, 'empty', 'after');
    const model = await t.service.read(session);
    expect(model?.open).toEqual([]);
    expect(model?.hidden).toEqual([]);
    expect(t.ran()).toEqual([]);
  });

  it('runs nothing of an enabled installation before there is a record to answer', async () => {
    const config = tempDir();
    const install = join(config, 'cache', 'sminos', 'bin', 'sminos');
    mkdirSync(join(install, '..'), { recursive: true });
    mkdirSync(join(config, 'plugins'));
    writeFileSync(install, '#!/bin/sh\necho "$0" >> "$FAKE_SMINOS_RAN"\nexit 3\n');
    chmodSync(install, 0o755);
    writeFileSync(join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'sminos@market': [{ scope: 'user', installPath: join(config, 'cache', 'sminos') }] } }));
    writeFileSync(join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'sminos@market': true } }));
    const t = start({ named: null, configHome: config, locate: { underTest: false, systemRoot: tempDir() } });
    await t.service.list();
    const handlers = wire(t.service);
    await handlers.invoke('sheet.list', {});
    expect(t.ran()).toEqual([]);
    seedRecord(t.home, 'two-surfaces');
    expect(await handlers.invoke('sheet.read', { session: TWO })).toMatchObject({ model: { session: TWO } });
    await vi.waitFor(() => expect(t.service.door()).toEqual({ known: true, available: true }));
    expect(t.ran()).toEqual([install]);
  });

  it('tells the windows when the probe behind a read moves the door, with no file changed and no read asked', async () => {
    const dir = tempDir();
    const cli = join(dir, 'sminos');
    cpSync(FAKE_SMINOS, cli);
    chmodSync(cli, 0o644); // found, and it does not start: unavailable
    const t = start({ named: cli });
    seedRecord(t.home, 'two-surfaces');
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(1));
    const summary = of(t.emitted, TWO)[0]!.summary;
    const handlers = wire(t.service);
    let heard = 0;
    t.service.onChange(() => void (heard += 1));
    expect(await handlers.invoke('sheet.read', { session: TWO })).toMatchObject({ door: { known: false } });
    await vi.waitFor(() => expect(of(t.emitted, TWO)).toHaveLength(2)); // the probe ended: the record announced again, as it was
    expect(of(t.emitted, TWO)[1]!.summary).toEqual(summary);
    expect(heard).toBe(0); // to the windows only: no record changed
    expect(await handlers.invoke('sheet.list', {})).toMatchObject({ door: { known: true, available: false } });
    chmodSync(cli, 0o755);
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: true }); // a later probe succeeds
    expect(of(t.emitted, TWO)[2]!.summary).toEqual(summary); // the door's move, announced before the put's line
    await vi.waitFor(() => expect(of(t.emitted, TWO).at(-1)?.summary).toMatchObject({ queued: 1 }));
    expect(await handlers.invoke('sheet.list', {})).toMatchObject({ door: { known: true, available: true } });
    const before = t.emitted.length;
    await t.service.read(TWO); // known available: nothing located, nothing announced
    await sleep(100);
    expect(t.emitted.slice(before)).toEqual([]);
  });

  it('answers a read at once while the probe hangs, the door as it stood, and lets the probe end behind it', async () => {
    const t = start({ named: slowDoor({ show: 'hang' }), timing: { probeMs: 500 } });
    seedRecord(t.home, 'two-surfaces');
    const asked = Date.now();
    expect(await wire(t.service).invoke('sheet.read', { session: TWO })).toMatchObject({ model: { session: TWO }, door: { known: false } });
    expect(Date.now() - asked).toBeLessThan(300);
    await vi.waitFor(() => expect(t.service.door()).toMatchObject({ known: true, available: false }), { timeout: 2000 });
  });

  it('answers a put within its one budget while the probe hangs', async () => {
    const t = start({ named: slowDoor({ show: 'hang' }), timing: { putMs: 800 } });
    seedRecord(t.home, 'two-surfaces');
    const asked = Date.now();
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false });
    expect(Date.now() - asked).toBeLessThan(1300);
  });

  it('answers a put within its one budget when a read’s probe is already out and hangs', async () => {
    const t = start({ named: slowDoor({ show: 'hang' }), timing: { putMs: 800 } }); // the read's probe has its own 10 s
    seedRecord(t.home, 'two-surfaces');
    await t.service.read(TWO);
    const asked = Date.now();
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false, why: 'failed' });
    expect(Date.now() - asked).toBeLessThan(1300);
  });

  it('gives the door what the probe left of the put’s budget', async () => {
    const t = start({ named: slowDoor({ show: 0.3, put: 1 }), timing: { putMs: 1200 } }); // the door alone would fit, not after the probe
    seedRecord(t.home, 'two-surfaces');
    const asked = Date.now();
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false, why: 'failed' });
    expect(Date.now() - asked).toBeLessThan(1700);
    expect(t.service.door()).toEqual({ known: true, available: true }); // the probe itself answered
  });

  it('says the door is unavailable, and why, when no command is found; reading still works', async () => {
    const t = start({ named: null });
    seedRecord(t.home, 'two-surfaces');
    expect(await t.service.read(TWO)).not.toBeNull();
    await vi.waitFor(() => expect(t.service.door()).toMatchObject({ known: true, available: false, reason: expect.any(String) }));
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false, why: 'unavailable' });
  });
});

describe('put', () => {
  it('appends through the door and answers its first word', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toEqual({ ok: true, results: [{ key: 'maws-00000001', state: 'queued' }] });
    await vi.waitFor(() => expect(of(t.emitted, TWO).at(-1)?.summary).toMatchObject({ queued: 1 }));
  });

  it('refuses, before any process starts, more than fifty lines, a line lineError refuses, no line, or a name that is no session', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    const many = Array.from({ length: 51 }, (_, i) => answer(`maws-${String(i).padStart(8, '0')}`, ['Yes']));
    expect(await t.service.put(TWO, many)).toMatchObject({ ok: false, why: 'refused' });
    expect(await t.service.put(TWO, [{ v: 1, key: 'maws-00000001', kind: 'answer', id: 'q1', by: 'maws' } as SheetLine])).toMatchObject({ ok: false, why: 'refused' }); // no revision, no picks
    expect(await t.service.put(TWO, [])).toMatchObject({ ok: false, why: 'refused' });
    expect(await t.service.put('..', [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false, why: 'refused' });
    expect(t.ran()).toEqual([]);
  });

  it('answers no-sheet for a session with no record, with nothing located or run', async () => {
    const t = start();
    await t.service.list();
    expect(await t.service.put(OTHER, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false, why: 'no-sheet' });
    mkdirSync(t.record(OTHER), { recursive: true }); // a directory with no state.json is no record either
    writeFileSync(join(t.record(OTHER), 'inbox.jsonl'), '');
    expect(await t.service.put(OTHER, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false, why: 'no-sheet' });
    expect(t.ran()).toEqual([]);
    expect(t.service.door()).toEqual({ known: false });
    expect(readFileSync(join(t.record(OTHER), 'inbox.jsonl'), 'utf8')).toBe('');
  });

  it('refuses, before any process starts, a record whose inbox is a link or not a regular file, and takes one with none', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    const inbox = join(t.record(TWO), 'inbox.jsonl');
    const elsewhere = join(tempDir(), 'inbox.jsonl');
    writeFileSync(elsewhere, '');
    rmSync(inbox, { force: true });
    symlinkSync(elsewhere, inbox);
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false, why: 'refused' });
    rmSync(inbox);
    mkdirSync(inbox);
    expect(await t.service.put(TWO, [answer('maws-00000002', ['Yes'])])).toMatchObject({ ok: false, why: 'refused' });
    expect(t.ran()).toEqual([]);
    expect(readFileSync(elsewhere, 'utf8')).toBe('');
    rmSync(inbox, { recursive: true });
    expect(await t.service.put(TWO, [answer('maws-00000003', ['Yes'])])).toMatchObject({ ok: true });
  });

  it('refuses, before any process starts, a line no surface writes: a delivered line from a caller in the process', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    const delivered = { v: 1, key: 'maws-00000001', kind: 'delivered', by: 'maws' } as unknown as SheetLine;
    expect(await t.service.put(TWO, [delivered])).toMatchObject({ ok: false, why: 'refused' });
    const extra = { ...answer('maws-00000002', ['Yes']), at: '2026-11-24T00:00:00.000Z' } as SheetLine; // the door's own field
    expect(await t.service.put(TWO, [extra])).toMatchObject({ ok: false, why: 'refused' });
    expect(t.ran()).toEqual([]);
  });

  it('proves the command again when a spawn fails', async () => {
    const dir = tempDir();
    const cli = join(dir, 'sminos');
    cpSync(FAKE_SMINOS, cli);
    chmodSync(cli, 0o755);
    const t = start({ named: cli });
    seedRecord(t.home, 'two-surfaces');
    await t.service.read(TWO);
    await vi.waitFor(() => expect(t.service.door()).toEqual({ known: true, available: true }));
    expect(t.ran()).toEqual([cli]);
    chmodSync(cli, 0o644); // the proof's path and time stand, and it no longer starts
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: false, why: 'unavailable' });
    expect(t.service.door()).toMatchObject({ known: true, available: false });
    chmodSync(cli, 0o755);
    expect(await t.service.put(TWO, [answer('maws-00000001', ['Yes'])])).toMatchObject({ ok: true });
    expect(t.ran()).toEqual([cli, cli, cli]); // the first probe, a second probe, the put
    expect(t.service.door()).toEqual({ known: true, available: true });
    unlinkSync(cli); // an update removed the version's directory
    expect(await t.service.put(TWO, [answer('maws-00000002', ['Yes'])])).toMatchObject({ ok: false, why: 'unavailable' });
  });
});

// The wire's handlers over a service, as the spine registers them.
function wire(service: SheetService) {
  const handlers = new Map<string, (input: unknown, context: HandlerContext) => unknown>();
  registerSheet(service, ((name: string, handler: (input: unknown, context: HandlerContext) => unknown) => void handlers.set(name, handler)) as never);
  return { invoke: async (name: string, input: unknown) => handlers.get(name)!(input, {} as HandlerContext) };
}

describe('the wire', () => {
  it('stamps `by: maws` on every line, whatever the window sent', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    expect(await wire(t.service).invoke('sheet.put', { session: TWO, lines: [answer('maws-00000001', ['Yes'], 'page')] })).toMatchObject({ ok: true });
    const inbox = readFileSync(join(t.record(TWO), 'inbox.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { by: string });
    expect(inbox.map((line) => line.by)).toEqual(['maws']);
  });

  it('refuses more than fifty lines, or a line lineError refuses, with no process started', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    const many = Array.from({ length: 51 }, (_, i) => answer(`maws-${String(i).padStart(8, '0')}`, ['Yes']));
    expect(await wire(t.service).invoke('sheet.put', { session: TWO, lines: many })).toMatchObject({ ok: false, why: 'refused' });
    expect(await wire(t.service).invoke('sheet.put', { session: TWO, lines: [{ v: 1, key: 'maws-00000001', kind: 'dismiss', by: 'maws' }] })).toMatchObject({ ok: false, why: 'refused' }); // a dismissal names no id
    expect(t.ran()).toEqual([]);
  });

  it('gives `sheet.put` a budget past the door’s own bound, so main does not answer a timeout while the door still runs', () => {
    expect(COMMAND_BUDGETS_MS['sheet.put']).toBeGreaterThan(SHEET_TIMING.putMs);
  });

  it('answers the list and a read with the door’s state', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    await vi.waitFor(async () => expect(((await wire(t.service).invoke('sheet.list', {})) as { sessions: unknown[] }).sessions).toHaveLength(1));
    expect(await wire(t.service).invoke('sheet.list', {})).toMatchObject({ door: { known: false } });
    expect(await wire(t.service).invoke('sheet.read', { session: TWO })).toMatchObject({ model: { session: TWO }, door: { known: false } }); // as it stands: the probe goes on
    await vi.waitFor(() => expect(t.service.door()).toEqual({ known: true, available: true }));
    expect(await wire(t.service).invoke('sheet.read', { session: TWO })).toMatchObject({ door: { known: true, available: true } });
  });
});

describe('bodies and uploads, confined to the record', () => {
  const refs = (home: string) => join(home, 'sheet', REFS, 'refs');

  it('serves a listed question’s text reference as text and its image as the raster type it is', async () => {
    const t = start();
    seedRecord(t.home, 'references');
    const model = (await t.service.read(REFS))!;
    const [text, , image] = model.open.flatMap((q) => q.references);
    expect(await t.service.body(REFS, { ref: text!.sha256 })).toEqual({ kind: 'text', text: readFileSync(join(refs(t.home), text!.sha256), 'utf8') });
    expect(await t.service.body(REFS, { ref: image!.sha256 })).toEqual({ kind: 'image', mediaType: 'image/png', data: readFileSync(join(refs(t.home), image!.sha256)).toString('base64') });
  });

  it('is gone for a hash no listed question names, a body that is a link or a special file, and an image whose bytes are not its type', async () => {
    const t = start();
    seedRecord(t.home, 'references');
    const model = (await t.service.read(REFS))!;
    const [text, plain, image] = model.open.flatMap((q) => q.references);
    expect(await t.service.body(REFS, { ref: 'a'.repeat(64) })).toEqual({ kind: 'gone' });
    const outside = join(tempDir(), 'secret.txt');
    writeFileSync(outside, 'not the record’s');
    rmSync(join(refs(t.home), text!.sha256));
    symlinkSync(outside, join(refs(t.home), text!.sha256));
    expect(await t.service.body(REFS, { ref: text!.sha256 })).toEqual({ kind: 'gone' });
    rmSync(join(refs(t.home), plain!.sha256));
    execFileSync('mkfifo', [join(refs(t.home), plain!.sha256)]);
    expect(await t.service.body(REFS, { ref: plain!.sha256 })).toEqual({ kind: 'gone' });
    writeFileSync(join(refs(t.home), image!.sha256), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await t.service.body(REFS, { ref: image!.sha256 })).toEqual({ kind: 'gone' });
  });

  it('is gone when refs/ is a link', async () => {
    const t = start();
    seedRecord(t.home, 'references');
    const model = (await t.service.read(REFS))!;
    const [text] = model.open.flatMap((q) => q.references);
    const elsewhere = tempDir();
    cpSync(refs(t.home), elsewhere, { recursive: true });
    rmSync(refs(t.home), { recursive: true });
    symlinkSync(elsewhere, refs(t.home));
    expect(await t.service.body(REFS, { ref: text!.sha256 })).toEqual({ kind: 'gone' });
  });

  it('serves a pending outcome’s text file, and nothing else under texts/', async () => {
    const t = start();
    const session = seedRecord(t.home, 'long-text', 'after');
    const model = (await t.service.read(session))!;
    const file = (model.pending[0] as { textFile?: string }).textFile!;
    const sha = file.slice('texts/'.length, -'.txt'.length);
    expect(await t.service.body(session, { text: sha })).toEqual({ kind: 'text', text: readFileSync(join(t.record(session), file), 'utf8') });
    writeFileSync(join(t.record(session), 'texts', `${'b'.repeat(64)}.txt`), 'stray');
    expect(await t.service.body(session, { text: 'b'.repeat(64) })).toEqual({ kind: 'gone' });
  });

  it('writes an upload exclusively at 0600 under an uploads/ it makes at 0700, and serves it back though no model names it', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    const uploaded = await t.service.upload(TWO, { mediaType: 'image/png', data: PNG.toString('base64') });
    if (!uploaded.ok) throw new Error(uploaded.why);
    expect(uploaded.path).toMatch(/^uploads\/maws-[0-9a-f]{32}\.png$/);
    expect(statSync(join(t.record(TWO), 'uploads')).mode & 0o777).toBe(0o700);
    expect(statSync(join(t.record(TWO), uploaded.path)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(t.record(TWO), uploaded.path))).toEqual(PNG);
    expect(await t.service.body(TWO, { upload: uploaded.path })).toEqual({ kind: 'image', mediaType: 'image/png', data: PNG.toString('base64') });
    const second = await t.service.upload(TWO, { mediaType: 'image/png', data: PNG.toString('base64') });
    expect(second.ok).toBe(true);
    expect(second.ok && second.path).not.toBe(uploaded.path);
  });

  it('is gone for an upload under a session that has no record', async () => {
    const t = start();
    mkdirSync(join(t.record(OTHER), 'uploads'), { recursive: true });
    writeFileSync(join(t.record(OTHER), 'uploads', 'sketch.png'), PNG);
    expect(await t.service.body(OTHER, { upload: 'uploads/sketch.png' })).toEqual({ kind: 'gone' });
  });

  it('is gone for a file under uploads/ whose bytes are not its name’s raster type', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    mkdirSync(join(t.record(TWO), 'uploads'));
    writeFileSync(join(t.record(TWO), 'uploads', 'page.png'), '<html><script>alert(1)</script></html>');
    expect(await t.service.body(TWO, { upload: 'uploads/page.png' })).toEqual({ kind: 'gone' });
    expect(await t.service.body(TWO, { upload: 'uploads/missing.png' })).toEqual({ kind: 'gone' });
  });

  it('refuses an upload whose bytes are not the type it names, past 5 MiB, or with no record', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    expect(await t.service.upload(TWO, { mediaType: 'image/jpeg', data: PNG.toString('base64') })).toMatchObject({ ok: false });
    expect(await t.service.upload(TWO, { mediaType: 'image/png', data: Buffer.from('<svg/>').toString('base64') })).toMatchObject({ ok: false });
    expect(await t.service.upload(TWO, { mediaType: 'image/png', data: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]).toString('base64') })).toMatchObject({ ok: false });
    expect(await t.service.upload(TWO, { mediaType: 'image/png', data: 'not base64!' })).toMatchObject({ ok: false });
    expect(await t.service.upload(OTHER, { mediaType: 'image/png', data: PNG.toString('base64') })).toMatchObject({ ok: false });
    expect(existsSync(join(t.record(TWO), 'uploads'))).toBe(false);
    expect(existsSync(t.record(OTHER))).toBe(false);
  });

  it('writes nothing into a record whose uploads/ is a link', async () => {
    const t = start();
    seedRecord(t.home, 'two-surfaces');
    const elsewhere = tempDir();
    symlinkSync(elsewhere, join(t.record(TWO), 'uploads'));
    expect(await t.service.upload(TWO, { mediaType: 'image/png', data: PNG.toString('base64') })).toMatchObject({ ok: false });
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('refuses a name that is no session, and a record directory that is a link, and leaves the link’s target as it was', async () => {
    const t = start();
    const elsewhere = tempDir();
    cpSync(join(SHEET_FIXTURES, 'references/before/sheet', REFS), elsewhere, { recursive: true });
    const held = readdirSync(elsewhere, { recursive: true }).sort();
    mkdirSync(join(t.home, 'sheet'));
    symlinkSync(elsewhere, t.record(REFS));
    const sha = (JSON.parse(readFileSync(join(elsewhere, 'state.json'), 'utf8')) as { questions: { references: { sha256: string }[] }[] }).questions[0]!.references[0]!.sha256;
    for (const session of ['..', 'a/b', '../sheet', REFS.toUpperCase(), REFS]) {
      expect(await t.service.read(session), session).toBeNull();
      expect(await t.service.body(session, { ref: sha }), session).toEqual({ kind: 'gone' });
      expect(await t.service.upload(session, { mediaType: 'image/png', data: PNG.toString('base64') }), session).toMatchObject({ ok: false });
    }
    expect(readdirSync(elsewhere, { recursive: true }).sort()).toEqual(held);
    expect(t.ran()).toEqual([]);
  });
});

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { QueueEntry, QueueState } from '@shared/engine/session-state-store';
import { FileSessionStateStore } from './file-session-state-store';
import { scriptedSession } from '../conformance/session-harness'; // P5 O2 M2

// P5 O2 M2: a disk that fails a write (ENOSPC) or an unlink (EACCES) at chosen paths, for the cron record's fail-closed save
const disk = vi.hoisted(() => ({ writeFails: null as ((path: string) => boolean) | null, unlinkFails: null as ((path: string) => boolean) | null }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const writeFile = (async (...args: Parameters<typeof actual.writeFile>) => {
    if (disk.writeFails?.(String(args[0]))) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    return actual.writeFile(...args);
  }) as typeof actual.writeFile;
  const unlink = (async (...args: Parameters<typeof actual.unlink>) => {
    if (disk.unlinkFails?.(String(args[0]))) throw Object.assign(new Error('EACCES: permission denied, unlink'), { code: 'EACCES' });
    return actual.unlink(...args);
  }) as typeof actual.unlink;
  return { ...actual, default: { ...actual, writeFile, unlink }, writeFile, unlink };
});

const ID = 'app-store-1' as AppSessionId;
const spec = LaunchSpecSchema.parse({
  appSessionId: ID, cwd: '/tmp/x', additionalDirectories: [], model: 'sonnet', effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
  resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null /* C10 */, replay: null,
});
const entry = (over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId: 'q-1', appSessionId: ID, content: 'hello', createdAt: '2026-09-28T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
});

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-store-'));
});
afterEach(async () => {
  disk.writeFails = disk.unlinkFails = null;
  await rm(userData, { recursive: true, force: true });
});

describe('FileSessionStateStore', () => {
  it('answers the empty state for a session it has never seen', async () => {
    const store = new FileSessionStateStore(userData);
    expect(await store.loadQueue(ID)).toEqual({ entries: [], paused: false, corrupt: null });
    expect(await store.loadGrants(ID)).toEqual({ allow: [] });
    expect(await store.loadLaunchSpec(ID)).toBeNull();
  });

  it('round-trips the queue, paused flag, grants and launch spec through a new instance (a simulated crash), in one versioned file', async () => {
    const before = new FileSessionStateStore(userData);
    const submitting = entry({ queueId: 'q-2', state: 'submitting', messageUuid: '11111111-1111-4111-8111-111111111111' as QueueEntry['messageUuid'], submittedAt: '2026-09-28T10:00:01.000Z' });
    // issued without awaiting, as the queue and the broker do: the store serialises them per session
    const saves = [before.saveQueue(ID, { entries: [entry(), submitting], paused: true }), before.saveGrants(ID, { allow: ['Bash(touch granted.txt)'] }), before.saveLaunchSpec(ID, spec)];
    await Promise.all(saves);

    const after = new FileSessionStateStore(userData);
    expect(await after.loadQueue(ID)).toEqual({ entries: [entry(), submitting], paused: true, corrupt: null });
    expect(await after.loadGrants(ID)).toEqual({ allow: ['Bash(touch granted.txt)'] });
    expect(await after.loadLaunchSpec(ID)).toEqual(spec);

    const dir = join(userData, 'engine-host', 'state');
    expect(await readdir(dir)).toEqual([`${ID}.json`]); // the temp file was renamed away
    const file = JSON.parse(await readFile(join(dir, `${ID}.json`), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual(['version', 'queue', 'grants', 'launchSpec']);
    expect(file.version).toBe(1);
  });

  it('loads a newer build’s unknown state and launch keys without losing the queue or grants, and writes only the current shape', async () => {
    const dir = join(userData, 'engine-host', 'state');
    const path = join(dir, `${ID}.json`);
    await mkdir(dir, { recursive: true });
    const queue = { entries: [entry()], paused: true, pauseReason: 'user' as const };
    const grants = { allow: ['Bash(touch granted.txt)'] };
    const text = JSON.stringify({ version: 1, queue, grants, launchSpec: { ...spec, futureLaunchKey: { version: 2 } }, futureStateKey: true });
    await writeFile(path, text);
    const warnings: string[] = [];
    const store = new FileSessionStateStore(userData, { warn: (m) => warnings.push(m) });

    expect(await store.loadGrants(ID)).toEqual(grants); // a launch reads grants first
    expect(await store.loadQueue(ID)).toEqual({ ...queue, corrupt: null });
    expect(await store.loadLaunchSpec(ID)).toEqual(spec);
    expect(warnings).toEqual([]);
    expect(await readdir(dir)).toEqual([`${ID}.json`]);
    expect(await readFile(path, 'utf8')).toBe(text); // reads neither rewrite nor move the file

    await store.saveQueue(ID, queue);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, queue, grants, launchSpec: spec });
    await expect(store.saveLaunchSpec(ID, { ...spec, futureLaunchKey: true } as typeof spec)).rejects.toThrow(); // writes remain strict
  });

  // P2-F L117: the same separation one level down, for the queue's and grants' objects and the stored spec's nested ones
  it('loads a newer build’s unknown keys inside queue entries, steers, the queue, grants and the spec’s resume, trust and retry, and writes only the current shape', async () => {
    const dir = join(userData, 'engine-host', 'state');
    const path = join(dir, `${ID}.json`);
    await mkdir(dir, { recursive: true });
    const steer = { messageUuid: '22222222-2222-4222-8222-222222222222', content: 'now', createdAt: '2026-09-28T10:00:02.000Z' };
    const queue = { entries: [entry()], paused: false, steers: [steer] };
    const grants = { allow: ['Bash(touch granted.txt)'] };
    const nested = { ...spec, resume: { sessionId: '33333333-3333-4333-8333-333333333333', fork: false }, trust: { accepted: true as const, directory: '/tmp/x' }, retry: { attempt: 1, maxAttempts: 2, reason: 'no_output' } };
    const later = <T extends object>(value: T) => ({ ...value, futureKey: 1 });
    const text = JSON.stringify({
      version: 1,
      queue: later({ ...queue, entries: [later(entry())], steers: [later(steer)] }),
      grants: later(grants),
      launchSpec: { ...nested, resume: later(nested.resume), trust: later(nested.trust), retry: later(nested.retry) },
    });
    await writeFile(path, text);
    const warnings: string[] = [];
    const store = new FileSessionStateStore(userData, { warn: (m) => warnings.push(m) });

    expect(await store.loadGrants(ID)).toEqual(grants);
    expect(await store.loadQueue(ID)).toEqual({ ...queue, corrupt: null });
    expect(await store.loadLaunchSpec(ID)).toEqual(nested);
    expect(warnings).toEqual([]);
    expect(await readdir(dir)).toEqual([`${ID}.json`]);
    expect(await readFile(path, 'utf8')).toBe(text); // reads neither rewrite nor move the file

    await store.saveGrants(ID, grants);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, queue, grants, launchSpec: nested });
    await expect(store.saveQueue(ID, later(queue) as unknown as QueueState)).rejects.toThrow(); // writes remain strict
    await expect(store.saveGrants(ID, later(grants) as typeof grants)).rejects.toThrow();
  });

  it('exists answers whether a state file exists; loadQueue on it shows the persisted queue untouched (no recovery transition)', async () => {
    const store = new FileSessionStateStore(userData);
    expect(await store.exists(ID)).toBe(false);
    const persisted = { entries: [entry({ state: 'submitting', messageUuid: '11111111-1111-4111-8111-111111111111' as QueueEntry['messageUuid'], submittedAt: '2026-09-28T10:00:01.000Z' }), entry({ queueId: 'q-2', state: 'released', messageUuid: '22222222-2222-4222-8222-222222222222' as QueueEntry['messageUuid'], submittedAt: '2026-09-28T10:00:02.000Z' })], paused: false };
    await store.saveQueue(ID, persisted);
    expect(await store.exists(ID)).toBe(true);
    const file = await readFile(join(userData, 'engine-host', 'state', `${ID}.json`), 'utf8');
    expect(await store.loadQueue(ID)).toEqual({ ...persisted, corrupt: null });
    expect(await readFile(join(userData, 'engine-host', 'state', `${ID}.json`), 'utf8')).toBe(file);
    await store.forget(ID);
    expect(await store.exists(ID)).toBe(false);
  });

  it('a load issued after a save sees it, even across instances sharing the directory', async () => {
    const store = new FileSessionStateStore(userData);
    const saved = store.saveQueue(ID, { entries: [entry()], paused: false });
    const loaded = store.loadQueue(ID);
    await saved;
    expect((await loaded).entries).toHaveLength(1);
  });

  it('refuses to persist a queue that is not a valid QueueState', async () => {
    const store = new FileSessionStateStore(userData);
    await expect(store.saveQueue(ID, { entries: [{ ...entry(), state: 'sent' } as unknown as QueueEntry], paused: false })).rejects.toThrow();
    expect(await store.loadQueue(ID)).toEqual({ entries: [], paused: false, corrupt: null });
  });

  it('an unreadable file is moved aside and kept, and the next queue load reports where, once (even when a grants load found it first)', async () => {
    const dir = join(userData, 'engine-host', 'state');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ID}.json`), '{"version":1,"queue":');
    const warnings: string[] = [];
    const store = new FileSessionStateStore(userData, { warn: (m) => warnings.push(m) });
    expect(await store.loadGrants(ID)).toEqual({ allow: [] }); // a launch reads grants first
    await store.saveLaunchSpec(ID, spec); // and writes a fresh file before the queue is loaded
    const loaded = await store.loadQueue(ID);
    expect(loaded).toMatchObject({ entries: [], paused: false, corrupt: expect.stringMatching(new RegExp(`${ID}\\.json\\.corrupt-\\d+$`)) });
    expect(await readFile(loaded.corrupt!, 'utf8')).toBe('{"version":1,"queue":'); // kept, byte for byte
    expect(warnings).toHaveLength(1);
    expect((await store.loadQueue(ID)).corrupt).toBeNull();
  });

  it('forget deletes the state file and the session\'s journal directory', async () => {
    const store = new FileSessionStateStore(userData);
    await store.saveGrants(ID, { allow: ['Bash'] });
    const journalDir = join(userData, 'engine-host', 'journal', ID);
    await mkdir(journalDir, { recursive: true });
    await writeFile(join(journalDir, 'L1.jsonl'), '');
    await store.forget(ID);
    expect(await readdir(join(userData, 'engine-host', 'state'))).toEqual([]);
    await expect(readdir(journalDir)).rejects.toThrow();
    expect(await store.loadGrants(ID)).toEqual({ allow: [] });
  });

  it('forgetJournal (archive) deletes the session\'s journal directory and keeps the state file with its queue and grants', async () => {
    const store = new FileSessionStateStore(userData);
    const queue = { entries: [entry()], paused: true };
    await store.saveQueue(ID, queue);
    await store.saveGrants(ID, { allow: ['Bash'] });
    const journalDir = join(userData, 'engine-host', 'journal', ID);
    await mkdir(journalDir, { recursive: true });
    await writeFile(join(journalDir, 'L1.jsonl'), '');
    await store.forgetJournal(ID);
    await expect(readdir(journalDir)).rejects.toThrow();
    expect(await readdir(join(userData, 'engine-host', 'state'))).toEqual([`${ID}.json`]);
    expect(await store.loadQueue(ID)).toEqual({ ...queue, corrupt: null });
    expect(await store.loadGrants(ID)).toEqual({ allow: ['Bash'] });
  });
});

// C7 start: the queue's pause reason rides next to `paused` in the state file (architect's ruling on C7's Decision Log
// item 2): a closed set, absent in files written before it existed.
describe('FileSessionStateStore: the pause reason (C7)', () => {
  it('round-trips the reason through a new instance and loads an older file without one', async () => {
    await new FileSessionStateStore(userData).saveQueue(ID, { entries: [entry()], paused: true, pauseReason: 'interrupt' });
    expect(await new FileSessionStateStore(userData).loadQueue(ID)).toEqual({ entries: [entry()], paused: true, pauseReason: 'interrupt', corrupt: null });

    const dir = join(userData, 'engine-host', 'state');
    await writeFile(join(dir, `${ID}.json`), JSON.stringify({ version: 1, queue: { entries: [], paused: true }, grants: { allow: [] }, launchSpec: null }));
    const legacy = await new FileSessionStateStore(userData).loadQueue(ID);
    expect(legacy).toEqual({ entries: [], paused: true, corrupt: null });
    expect(legacy.pauseReason).toBeUndefined();
  });

  it('refuses an unknown reason on save and treats a file carrying one as unreadable', async () => {
    const store = new FileSessionStateStore(userData, { warn: () => {} });
    await expect(store.saveQueue(ID, { entries: [], paused: true, pauseReason: 'bored' as never })).rejects.toThrow();
    const dir = join(userData, 'engine-host', 'state');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ID}.json`), JSON.stringify({ version: 1, queue: { entries: [], paused: true, pauseReason: 'bored' }, grants: { allow: [] }, launchSpec: null }));
    expect(await store.loadQueue(ID)).toMatchObject({ entries: [], paused: false, corrupt: expect.stringContaining('.corrupt-') });
  });
});
// C7 end

// P2-C start (2026-10-09): the two launch-spec keys never reach the state file (the P2-C document, Design §2 "What is
// recorded", R5), so an older build, whose strict reader knows neither, still reads the file this build wrote
describe('the owner channel’s launch-spec keys are not stored (P2-C)', () => {
  it('saveLaunchSpec writes neither key, and an older-shaped strict reader still parses the file', async () => {
    const store = new FileSessionStateStore(userData);
    await store.saveLaunchSpec(ID, { ...spec, appendSystemPrompt: '# Messages to the human (MAWS to-human contract 1)', systemPromptSnapshot: 'off' });
    const file = JSON.parse(await readFile(join(userData, 'engine-host', 'state', `${ID}.json`), 'utf8')) as { launchSpec: Record<string, unknown> };
    expect(file.launchSpec).not.toHaveProperty('appendSystemPrompt');
    expect(file.launchSpec).not.toHaveProperty('systemPromptSnapshot');
    expect(file.launchSpec).toEqual(JSON.parse(JSON.stringify(spec)));
    const OlderLaunchSpecSchema = LaunchSpecSchema.omit({ appendSystemPrompt: true, systemPromptSnapshot: true }); // strict, as every build's is
    expect(OlderLaunchSpecSchema.parse(file.launchSpec)).toEqual(spec);
    expect(await new FileSessionStateStore(userData).loadLaunchSpec(ID)).toEqual(spec);
  });
});
// P2-C end

describe('FileSessionStateStore: the keep mark and the engine session ids (P5 O2 M2)', () => {
  it('round-trips both through a new instance beside the queue, keeps them across the other saves, and reads an older file without them', async () => {
    const dir = join(userData, 'engine-host', 'state');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ID}.json`), JSON.stringify({ version: 1, queue: { entries: [], paused: false }, grants: { allow: [] }, launchSpec: null }));
    const older = new FileSessionStateStore(userData);
    expect(await older.loadKeep(ID)).toBe(false);
    expect(await older.loadEngineSessionIds(ID)).toEqual([]);

    await Promise.all([older.saveKeep(ID, true), older.saveEngineSessionIds(ID, ['e-1', 'e-2']), older.saveQueue(ID, { entries: [entry()], paused: false }), older.saveLaunchSpec(ID, spec)]);
    const after = new FileSessionStateStore(userData);
    expect(await after.loadKeep(ID)).toBe(true);
    expect(await after.loadEngineSessionIds(ID)).toEqual(['e-1', 'e-2']);
    expect((await after.loadQueue(ID)).entries).toEqual([entry()]);
  });

  // Branch review: an unreadable state file took the ids with it, so they are unavailable, never a clean empty list (which
  // would let a durable job an id before a /clear created read as no one's), until a save of them after a load succeeds.
  it.each<[string, (store: FileSessionStateStore) => Promise<unknown>]>([
    ['the ids\' own load', async () => {}],
    ['the keep mark\'s load (a launch reads it first)', (store) => store.loadKeep(ID)],
  ])('ids in a file moved aside as unreadable are unavailable, whichever load found it (%s), until they are saved again', async (_first, findFirst) => {
    const dir = join(userData, 'engine-host', 'state');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ID}.json`), '{"version":1,"engineSessionIds":["e-old"');
    const store = new FileSessionStateStore(userData, { warn: () => {} });
    await findFirst(store);
    await expect(store.loadEngineSessionIds(ID)).rejects.toThrow(/unavailable/);
    await store.saveLaunchSpec(ID, spec); // the launch's own writes make a fresh file, without the ids
    await expect(store.loadEngineSessionIds(ID)).rejects.toThrow(/unavailable/);
    expect(await store.loadKeep(ID)).toBe(false); // the other loads recover as they did
    expect((await store.loadQueue(ID)).corrupt).toMatch(/\.corrupt-\d+$/);
    await store.saveEngineSessionIds(ID, ['e-new']);
    expect(await store.loadEngineSessionIds(ID)).toEqual(['e-new']);
  });
});

// O16 M5 (D37): the launch whose process an observer bridge was seen on, beside the keep mark, kept across the other writes
describe('FileSessionStateStore: observerSeenLaunch (O16 M5)', () => {
  it('reads null until saved, then the launch saved, through the launch spec’s and queue’s writes and a new store', async () => {
    const store = new FileSessionStateStore(userData);
    expect(await store.loadObserverSeen(ID)).toBeNull();
    await store.saveObserverSeen(ID, 'launch-1');
    await Promise.all([store.saveLaunchSpec(ID, spec), store.saveQueue(ID, { entries: [entry()], paused: false })]);
    expect(await new FileSessionStateStore(userData).loadObserverSeen(ID)).toBe('launch-1');
  });
});

describe('FileSessionStateStore: the cron record (P5 O2 M2, P5 Decision Log 49)', () => {
  const record = { sessionCrons: [{ id: 'c1', schedule: '0 3 * * *', recurring: true, prompt: 'nightly' }], toolSinceStop: false };
  it('round-trips through a new instance; never written, it is null', async () => {
    const store = new FileSessionStateStore(userData);
    expect(await store.loadCronRecord(ID)).toBeNull();
    await store.saveCronRecord(ID, record);
    expect(await new FileSessionStateStore(userData).loadCronRecord(ID)).toEqual(record);
  });

  it('lives in its own file beside the state file, which a save of it never touches', async () => {
    const store = new FileSessionStateStore(userData);
    await store.saveGrants(ID, { allow: ['Bash(ls)'] });
    await store.saveCronRecord(ID, record);
    const dir = join(userData, 'engine-host', 'state');
    expect((await readdir(dir)).sort()).toEqual([`${ID}.cron.json`, `${ID}.json`]);
    expect(JSON.parse(await readFile(join(dir, `${ID}.json`), 'utf8'))).not.toHaveProperty('cronRecord');
    expect(JSON.parse(await readFile(join(dir, `${ID}.cron.json`), 'utf8'))).toEqual(record);
  });

  // the cold restart: the engine host dies after the failed writes, and a new store must not trust the older record
  const dirty = { sessionCrons: [], toolSinceStop: true };
  const RESUMED = '44444444-4444-4444-8444-444444444444';
  const resumedWork = async (store: FileSessionStateStore) => {
    const s = scriptedSession({ spec: { appSessionId: ID, resume: { sessionId: RESUMED as never, fork: false }, sessionId: null }, session: { store } });
    await s.session.start();
    return s.session.status().work;
  };

  it('a clean record makes a resume over a new store known and empty (the control for the next test)', async () => {
    await new FileSessionStateStore(userData).saveCronRecord(ID, { sessionCrons: [], toolSinceStop: false });
    expect(await resumedWork(new FileSessionStateStore(userData))).toEqual({ crons: [], unknown: null, descendants: 0 }); // O16 M5: nothing under its engine
  });

  it('after a rejected save (ENOSPC) a new store reads no record, so the older clean one cannot make the resume known and empty; a later save is read again', async () => {
    const before = new FileSessionStateStore(userData);
    await before.saveCronRecord(ID, { sessionCrons: [], toolSinceStop: false });
    disk.writeFails = () => true; // the disk is full
    await expect(before.saveCronRecord(ID, dirty)).rejects.toThrow('ENOSPC');
    await expect(before.saveCronRecord(ID, record)).rejects.toThrow('ENOSPC');
    expect(await before.loadCronRecord(ID)).toBeNull();
    const after = new FileSessionStateStore(userData); // the engine host restarted
    expect(await after.loadCronRecord(ID)).toBeNull();
    expect(await resumedWork(after)).toEqual({ crons: [], unknown: 'resumed', descendants: 0 });
    disk.writeFails = null; // storage recovers
    await after.saveCronRecord(ID, record);
    expect(await new FileSessionStateStore(userData).loadCronRecord(ID)).toEqual(record);
  });

  it('a rejected save whose unlink fails too is logged, rethrows the write\'s error, and this store reads no record until a save succeeds', async () => {
    const warnings: string[] = [];
    const store = new FileSessionStateStore(userData, { warn: (m) => void warnings.push(m) });
    await store.saveCronRecord(ID, { sessionCrons: [], toolSinceStop: false });
    disk.writeFails = () => true; // the disk is full
    disk.unlinkFails = (path) => path.endsWith(`${ID}.cron.json`);
    await expect(store.saveCronRecord(ID, dirty)).rejects.toThrow('ENOSPC');
    expect(warnings).toEqual([expect.stringMatching(/cron record for app-store-1 was not saved and its older record could not be removed \(EACCES/)]);
    expect(await store.loadCronRecord(ID)).toBeNull();
    disk.writeFails = disk.unlinkFails = null;
    await store.saveCronRecord(ID, record);
    expect(await store.loadCronRecord(ID)).toEqual(record);
  });

  it('a record of a shape this build cannot read is null, and the state file beside it still loads', async () => {
    const dir = join(userData, 'engine-host', 'state');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ID}.json`), JSON.stringify({ version: 1, queue: { entries: [entry()], paused: false }, grants: { allow: ['Bash(ls)'] }, launchSpec: null }));
    const store = new FileSessionStateStore(userData);
    for (const text of [JSON.stringify({ sessionCrons: 'none' }), '{"sessionCrons": [']) {
      await writeFile(join(dir, `${ID}.cron.json`), text);
      expect(await store.loadCronRecord(ID)).toBeNull();
    }
    expect(await store.loadGrants(ID)).toEqual({ allow: ['Bash(ls)'] });
    expect((await store.loadQueue(ID)).entries).toEqual([entry()]);
  });

  it('a record an earlier build of this branch left inside the state file reads as missing, and the file still loads', async () => {
    const dir = join(userData, 'engine-host', 'state');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ID}.json`), JSON.stringify({ version: 1, queue: { entries: [], paused: false }, grants: { allow: ['Bash(ls)'] }, launchSpec: null, cronRecord: { sessionCrons: [], toolSinceStop: false } }));
    const store = new FileSessionStateStore(userData);
    expect(await store.loadCronRecord(ID)).toBeNull();
    expect(await store.loadGrants(ID)).toEqual({ allow: ['Bash(ls)'] });
  });

  it('forget removes the cron record with the state file', async () => {
    const store = new FileSessionStateStore(userData);
    await store.saveCronRecord(ID, record);
    await store.forget(ID);
    expect(await new FileSessionStateStore(userData).loadCronRecord(ID)).toBeNull();
  });
});

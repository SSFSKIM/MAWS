import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { QueueEntry } from '@shared/engine/session-state-store';
import { FileSessionStateStore } from './file-session-state-store';

const ID = 'app-store-1' as AppSessionId;
const spec = LaunchSpecSchema.parse({
  appSessionId: ID, cwd: '/tmp/x', additionalDirectories: [], model: 'sonnet', effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
  resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null,
});
const entry = (over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId: 'q-1', appSessionId: ID, content: 'hello', createdAt: '2026-09-28T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, ...over,
});

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-store-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('FileSessionStateStore', () => {
  it('answers the empty state for a session it has never seen', async () => {
    const store = new FileSessionStateStore(userData);
    expect(await store.loadQueue(ID)).toEqual({ entries: [], paused: false });
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
    expect(await after.loadQueue(ID)).toEqual({ entries: [entry(), submitting], paused: true });
    expect(await after.loadGrants(ID)).toEqual({ allow: ['Bash(touch granted.txt)'] });
    expect(await after.loadLaunchSpec(ID)).toEqual(spec);

    const dir = join(userData, 'engine-host', 'state');
    expect(await readdir(dir)).toEqual([`${ID}.json`]); // the temp file was renamed away
    const file = JSON.parse(await readFile(join(dir, `${ID}.json`), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual(['version', 'queue', 'grants', 'launchSpec']);
    expect(file.version).toBe(1);
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
    expect(await store.loadQueue(ID)).toEqual({ entries: [], paused: false });
  });

  it('moves an unreadable file aside and starts empty, rather than failing every launch of the session', async () => {
    const dir = join(userData, 'engine-host', 'state');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ID}.json`), '{"version":1,"queue":');
    const warnings: string[] = [];
    const store = new FileSessionStateStore(userData, { warn: (m) => warnings.push(m) });
    expect(await store.loadQueue(ID)).toEqual({ entries: [], paused: false });
    expect(warnings).toHaveLength(1);
    const names = await readdir(dir);
    expect(names.some((n) => n.startsWith(`${ID}.json.corrupt-`))).toBe(true);
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
});

// The project's durable cron file as Background work reads it (E7 execution document, Design §7): `files.read` with
// `hash: true` (a missing file is no jobs, a refusal or a bad parse says why), kept current by `files.watch` on
// `<root>/.claude` when it exists, else on the root until it appears, re-resolved on each change event, an
// `invalidated` watch re-resolved, and released on dispose. Over the fake agent-work client's small disk; events carry
// main's realpaths (`/private/tmp/...` for a `/tmp/...` root).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeAgentWorkClient, flush, type FakeAgentWorkClient } from '../fake-work-client';
import { watchScheduledFile, type ScheduledFileState } from './scheduled-file';

const A = 'A' as AppSessionId;
const ROOT = '/tmp/repo';
const DIR = `${ROOT}/.claude`;
const FILE = `${DIR}/scheduled_tasks.json`;
const REAL = (path: string) => `/private${path}`;
const DURABLE = readFileSync(join(__dirname, '../../../../../../spikes/protocol-probe/fixtures/pass3/e7-cron-durable/scheduled_tasks.json'), 'utf8');
const AFTER_RESUME = readFileSync(join(__dirname, '../../../../../../spikes/protocol-probe/fixtures/pass3/e7-cron-durable/scheduled_tasks.after-resume.json'), 'utf8');

let fake: FakeAgentWorkClient;
let states: ScheduledFileState[];
let stop: (() => void) | null;

const start = async () => {
  stop = watchScheduledFile(fake.client, A, ROOT, (state) => states.push(state));
  await flush();
};
const change = async (path: string, kind: 'created' | 'changed' | 'removed' | 'invalidated' = 'changed', appSessionId: string = A) => {
  fake.filesChanged({ appSessionId, path, kind });
  await flush();
};
const ids = (state: ScheduledFileState | undefined) => (state?.status === 'ok' ? state.jobs.map((job) => job.id) : state);

beforeEach(() => {
  fake = fakeAgentWorkClient();
  states = [];
  stop = null;
});

afterEach(() => stop?.());

describe('watchScheduledFile', () => {
  it('watches .claude when it exists and reads the file with its hash; a change in .claude reads it again', async () => {
    fake.dirs.add(DIR);
    fake.files.set(FILE, DURABLE);
    await start();
    expect(fake.fileCalls).toEqual(['on filesChanged', `watch ${DIR}`, `read ${FILE}`]);
    expect(states).toEqual([{ status: 'loading' }, expect.objectContaining({ status: 'ok' })]);
    expect(ids(states.at(-1))).toEqual(['598b1690']);
    fake.files.set(FILE, JSON.stringify({ tasks: [{ id: 'n1', cron: '0 * * * *', prompt: 'new', createdAt: 1 }] }));
    await change(REAL(FILE));
    expect(fake.fileCalls.at(-1)).toBe(`read ${FILE}`);
    expect(ids(states.at(-1))).toEqual(['n1']);
  });

  it('asks files.read for the whole file’s hash', async () => {
    fake.dirs.add(DIR);
    fake.files.set(FILE, DURABLE);
    const inputs: unknown[] = [];
    const readFile = fake.client.readFile;
    fake.client.readFile = (input) => (inputs.push(input), readFile(input));
    await start();
    expect(inputs).toEqual([{ appSessionId: A, path: FILE, hash: true }]);
  });

  it('keeps its state when a change leaves the bytes as they were (the lock file, a rewrite of the same text)', async () => {
    fake.dirs.add(DIR);
    fake.files.set(FILE, DURABLE);
    await start();
    const count = states.length;
    await change(REAL(`${DIR}/scheduled_tasks.lock`));
    expect(fake.fileCalls.at(-1)).toBe(`read ${FILE}`);
    expect(states).toHaveLength(count);
    // the engine's rewrite on resume changes only creator fields: read, and the same jobs
    fake.files.set(FILE, AFTER_RESUME);
    await change(REAL(FILE));
    expect(states).toHaveLength(count + 1);
    expect(states.at(-1)).toEqual(states.at(-2));
  });

  it('ignores another session’s changes and a change outside the watched directory', async () => {
    fake.dirs.add(DIR);
    fake.files.set(FILE, DURABLE);
    await start();
    const calls = fake.fileCalls.length;
    await change(REAL(FILE), 'changed', 'B');
    await change(REAL(`${ROOT}/src/index.ts`));
    expect(fake.fileCalls).toHaveLength(calls);
  });

  it('with no .claude yet: no jobs, the root watched, and only .claude appearing there moves the watch and reads', async () => {
    fake.dirs.add(ROOT);
    await start();
    expect(fake.fileCalls).toEqual(['on filesChanged', `watch ${DIR}`, `read ${FILE}`, `watch ${ROOT}`]);
    expect(states.at(-1)).toEqual({ status: 'ok', jobs: [] });
    await change(REAL(`${ROOT}/README.md`));
    expect(fake.fileCalls.at(-1)).toBe(`watch ${ROOT}`); // nothing read
    fake.dirs.add(DIR);
    fake.files.set(FILE, DURABLE);
    await change(REAL(DIR), 'created');
    expect(fake.fileCalls.slice(4)).toEqual([`watch ${DIR}`, `read ${FILE}`, `unwatch ${ROOT}`]);
    expect(ids(states.at(-1))).toEqual(['598b1690']);
  });

  it('an invalidated watch is resolved again: .claude gone, the root watched and the file no jobs', async () => {
    fake.dirs.add(DIR).add(ROOT);
    fake.files.set(FILE, DURABLE);
    await start();
    fake.dirs.delete(DIR);
    fake.files.delete(FILE);
    await change(REAL(DIR), 'invalidated');
    expect(fake.fileCalls.slice(3)).toEqual([`watch ${DIR}`, `read ${FILE}`, `watch ${ROOT}`]);
    expect(states.at(-1)).toEqual({ status: 'ok', jobs: [] });
  });

  it('says why when the file cannot be read or parsed, and reads no jobs from it', async () => {
    fake.dirs.add(DIR);
    fake.refuse.set(FILE, "path outside the session's directories");
    await start();
    expect(states.at(-1)).toEqual({ status: 'error', message: "path outside the session's directories" });
    fake.refuse.delete(FILE);
    fake.files.set(FILE, '{"tasks": [');
    await change(REAL(FILE));
    expect(states.at(-1)).toMatchObject({ status: 'error' });
    expect((states.at(-1) as { message: string }).message.length).toBeGreaterThan(0);
  });

  it('holds no watch when neither directory can be watched, and still reads', async () => {
    await start();
    expect(fake.fileCalls).toEqual(['on filesChanged', `watch ${DIR}`, `read ${FILE}`, `watch ${ROOT}`]);
    stop!();
    stop = null;
    expect(fake.fileCalls.slice(4)).toEqual(['off filesChanged']);
  });

  it('dispose releases the watch it holds and its listener; a late answer lands nowhere', async () => {
    fake.dirs.add(DIR);
    fake.files.set(FILE, DURABLE);
    await start();
    fake.files.set(FILE, '{"tasks": []}');
    fake.filesChanged({ appSessionId: A, path: REAL(FILE), kind: 'changed' }); // its read in flight
    const count = states.length;
    stop!();
    stop = null;
    await flush();
    expect(fake.fileCalls.slice(-2)).toEqual(['off filesChanged', `unwatch ${DIR}`]);
    expect(states).toHaveLength(count);
  });

  it('a watch that answers after dispose is given back', async () => {
    fake.dirs.add(DIR);
    stop = watchScheduledFile(fake.client, A, ROOT, (state) => states.push(state));
    stop(); // before the watch answers
    stop = null;
    await flush();
    expect(fake.fileCalls.filter((c) => c.startsWith('watch') || c.startsWith('unwatch'))).toEqual([`watch ${DIR}`, `unwatch ${DIR}`]);
    expect(states).toEqual([{ status: 'loading' }]);
  });
});

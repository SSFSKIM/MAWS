// The writer's door (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §E, M2): `sminos sheet put` run
// with the inbox lines on standard input, each exit read as C2's I3 and the set's README give it. The stand-in door
// (test/support/fake-sminos-cli.mjs) is run through the same `execFile` path the real one takes; no test here reaches an
// installed sminos.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SheetLine } from '@shared/sheet/model';
import { FAKE_SMINOS, seedRecord, stageOutcome } from '../../../test/support/sheet-records';
import { DOOR_NOT_STARTED, putLines } from './door';
import { readRecord } from './reader';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-sheet-door-'));
  scratch.push(dir);
  return dir;
};

const answer = (key: string, picks: string[], id = 'q1'): SheetLine => ({ v: 1, key, kind: 'answer', id, revision: 1, picks, by: 'maws' });
const inboxOf = (home: string, session: string): Record<string, unknown>[] =>
  readFileSync(join(home, 'sheet', session, 'inbox.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);

// The stand-in named as the command, under a scratch home, with the knobs a test sets.
function door(knobs: Record<string, string> = {}) {
  const home = tempDir();
  return { home, cli: { path: FAKE_SMINOS, env: { PATH: process.env.PATH ?? '', SMINOS_HOME: home, ...knobs }, source: 'named' as const } };
}

describe('putLines', () => {
  it('appends the lines as compact JSON, one a line, and answers the first states the door printed', async () => {
    const { home, cli } = door();
    const session = seedRecord(home, 'two-surfaces');
    const lines = [answer('maws-0000000001', ['Yes']), { ...answer('maws-0000000002', ['No']), text: 'not yet' }];
    const result = await putLines(cli, session, lines, 10_000);
    expect(result).toEqual({ ok: true, results: [{ key: 'maws-0000000001', state: 'queued' }, { key: 'maws-0000000002', state: 'queued' }] });
    const appended = inboxOf(home, session);
    expect(appended.map((line) => Object.fromEntries(Object.entries(line).filter(([field]) => field !== 'at' && field !== 'batch')))).toEqual(lines);
    expect(new Set(appended.map((line) => line.batch)).size).toBe(1); // one call, one batch
  });

  it('passes a verdict through as the door printed it, `applied` included', async () => {
    const file = join(tempDir(), 'results.json');
    const { home, cli } = door({ FAKE_SMINOS_RESULTS: file });
    const session = seedRecord(home, 'two-surfaces');
    const results = [{ key: 'maws-0000000001', state: 'applied', kind: 'answer', id: 'q1', at: '2026-11-23T10:00:00.000Z', verdict: 'applied' }];
    writeFileSync(file, JSON.stringify({ session, results }));
    expect(await putLines(cli, session, [answer('maws-0000000001', ['Yes'])], 10_000)).toEqual({ ok: true, results });
  });

  it('takes exit 0 only when the object names the session asked for and holds one result for each line sent, by key', async () => {
    const lines = [answer('maws-0000000001', ['Yes']), answer('maws-0000000002', ['No'], 'q2')];
    const queued = (key: string) => ({ key, state: 'queued' });
    const cases: [string, (session: string) => unknown][] = [
      ['another session', () => ({ session: '5eed0000-0000-4000-8000-0000000000ff', results: [queued('maws-0000000001'), queued('maws-0000000002')] })],
      ['no session', () => ({ results: [queued('maws-0000000001'), queued('maws-0000000002')] })],
      ['a result missing', (session) => ({ session, results: [queued('maws-0000000001')] })],
      ['a result too many', (session) => ({ session, results: [queued('maws-0000000001'), queued('maws-0000000002'), queued('maws-0000000002')] })],
      ['a key not sent', (session) => ({ session, results: [queued('maws-0000000001'), queued('maws-0000000009')] })],
    ];
    for (const [label, printed] of cases) {
      const file = join(tempDir(), 'results.json');
      const { home, cli } = door({ FAKE_SMINOS_RESULTS: file });
      const session = seedRecord(home, 'two-surfaces');
      writeFileSync(file, JSON.stringify(printed(session)));
      expect(await putLines(cli, session, lines, 10_000), label).toMatchObject({ ok: false, why: 'failed' });
    }
    const file = join(tempDir(), 'results.json');
    const { home, cli } = door({ FAKE_SMINOS_RESULTS: file });
    const session = seedRecord(home, 'two-surfaces');
    writeFileSync(file, JSON.stringify({ session, results: [queued('maws-0000000002'), queued('maws-0000000001')] })); // by key, not by place
    expect(await putLines(cli, session, lines, 10_000)).toMatchObject({ ok: true });
  });

  it('reads exit 2 as refused with the first line of standard error, 3 as no sheet, 75 as busy, and 1 or any other as failed', async () => {
    const cases: [string, string][] = [['2', 'refused'], ['3', 'no-sheet'], ['75', 'busy'], ['1', 'failed'], ['9', 'failed']];
    for (const [code, why] of cases) {
      const { home, cli } = door({ FAKE_SMINOS_EXIT: code });
      const session = seedRecord(home, 'two-surfaces');
      const result = await putLines(cli, session, [answer('maws-0000000001', ['Yes'])], 10_000);
      expect(result, code).toMatchObject({ ok: false, why });
      expect(inboxOf(home, session), code).toEqual([]); // nothing appended
      if (why === 'refused') expect(result).toMatchObject({ message: `stand-in door: exit 2, as FAKE_SMINOS_EXIT asks` });
    }
  });

  it('reads a door that does not answer in time as failed', async () => {
    const { home, cli } = door({ FAKE_SMINOS_BARRIER: join(tempDir(), 'never') });
    const session = seedRecord(home, 'two-surfaces');
    expect(await putLines(cli, session, [answer('maws-0000000001', ['Yes'])], 400)).toMatchObject({ ok: false, why: 'failed' });
  });

  it('answers failed at its bound when the command ignores SIGTERM, and kills it after a short grace', async () => {
    const { home, cli } = door();
    const session = seedRecord(home, 'two-surfaces');
    const pidFile = join(tempDir(), 'pid');
    const stubborn = join(tempDir(), 'sminos');
    writeFileSync(stubborn, `#!/bin/sh\ntrap '' TERM\necho $$ > "${pidFile}"\nexec sleep 30\n`); // the pid written once TERM is ignored
    chmodSync(stubborn, 0o755);
    const asked = Date.now();
    expect(await putLines({ ...cli, path: stubborn }, session, [answer('maws-0000000001', ['Yes'])], 1000)).toMatchObject({ ok: false, why: 'failed' });
    expect(Date.now() - asked).toBeLessThan(1400);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await vi.waitFor(() => expect(alive()).toBe(false), { timeout: 3000, interval: 50 });
    expect(inboxOf(home, session)).toEqual([]);
  });

  it('reads output that is not the door’s object as failed', async () => {
    for (const printed of ['not json', '"a string"', JSON.stringify({ session: 'x', results: [{ key: 'short', state: 'queued' }] }), JSON.stringify({ session: 'x' })]) {
      const file = join(tempDir(), 'results.json');
      writeFileSync(file, printed);
      const { home, cli } = door({ FAKE_SMINOS_RESULTS: file });
      const session = seedRecord(home, 'two-surfaces');
      expect(await putLines(cli, session, [answer('maws-0000000001', ['Yes'])], 10_000), printed).toMatchObject({ ok: false, why: 'failed' });
    }
  });

  it('reads a command that cannot be started as failed, said as such, naming no path', async () => {
    const { home, cli } = door();
    const session = seedRecord(home, 'two-surfaces');
    const missing = await putLines({ ...cli, path: join(home, 'no-such-sminos') }, session, [answer('maws-0000000001', ['Yes'])], 10_000);
    expect(missing).toEqual({ ok: false, why: 'failed', message: DOOR_NOT_STARTED });
    const notExecutable = join(home, 'sminos');
    writeFileSync(notExecutable, '#!/bin/sh\nexit 0\n');
    chmodSync(notExecutable, 0o600);
    expect(await putLines({ ...cli, path: notExecutable }, session, [answer('maws-0000000001', ['Yes'])], 10_000)).toEqual({ ok: false, why: 'failed', message: DOOR_NOT_STARTED });
  });
});

describe('the stand-in door', () => {
  it('holds a put at its barrier, appending nothing, until the barrier’s file exists', async () => {
    const barrier = join(tempDir(), 'barrier');
    const ran = join(tempDir(), 'ran');
    const { home, cli } = door({ FAKE_SMINOS_BARRIER: barrier, FAKE_SMINOS_RAN: ran });
    const session = seedRecord(home, 'two-surfaces');
    const first = putLines(cli, session, [answer('maws-0000000001', ['Yes'])], 10_000);
    const second = putLines(cli, session, [answer('maws-0000000002', ['No'])], 10_000);
    for (let i = 0; i < 200 && !(existsSync(ran) && readFileSync(ran, 'utf8').split('\n').filter(Boolean).length === 2); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readFileSync(ran, 'utf8').split('\n').filter(Boolean)).toEqual([FAKE_SMINOS, FAKE_SMINOS]); // both started
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(inboxOf(home, session)).toEqual([]);
    writeFileSync(barrier, '');
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    expect(inboxOf(home, session).map((line) => line.key).sort()).toEqual(['maws-0000000001', 'maws-0000000002']);
  });

  it('replays a staged outcome: each appended line takes the next fixture key’s place, and the record becomes the fixture’s after', async () => {
    const { home, cli } = door();
    const session = seedRecord(home, 'two-surfaces');
    stageOutcome(home, 'two-surfaces', ['page-0401a001', 'cli-0401b002']);
    await putLines(cli, session, [answer('maws-first-0001', ['Yes'])], 10_000);
    const between = await readRecord(home, session);
    expect(between && 'model' in between && between.model.sent).toEqual([expect.objectContaining({ key: 'maws-first-0001', state: 'queued' })]); // not replayed yet
    await putLines(cli, session, [answer('maws-second-002', ['No'])], 10_000);
    const after = await readRecord(home, session);
    if (after === null || !('model' in after)) throw new Error(`no model: ${JSON.stringify(after)}`);
    expect(after.model.open).toEqual([]);
    expect(Object.fromEntries(after.model.sent.map((sent) => [sent.key, sent.state]))).toEqual({ 'maws-first-0001': 'accepted', 'maws-second-002': 'closed' });
    expect(existsSync(join(home, 'sheet', `${session}.next`))).toBe(false);
  });
});

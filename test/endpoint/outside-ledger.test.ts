// What the services' ledger keeps of the four acts on a file outside a session's folders (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, decision 4, §C, point 3; M2's "The
// ledger"; R4's and R5's ledger halves). Through a started endpoint's act path to the services' own `machine.op` over a
// real ledger file (sub-harness.ts's spine), with stand-in handlers that answer invented text:
// - a read's and a listing's operation met again answers the marker (`NOT_KEPT`, read through the endpoint's own
//   conversion as a failed outcome holding `issues.refusal: 'not-kept'`) and runs nothing; the file holds none of the
//   bytes answered, which the act's own caller was answered;
// - a save's text and sealed action are not kept; its small answer is, so a save met again runs nothing and its file is
//   written once;
// - a query of each answers `done`.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NOT_KEPT_REFUSAL } from '@shared/files/outside';
import { act, done, makeOrg, openRemote, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const dirs: string[] = [];
beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

const APP = 'app-elsewhere';
// invented words that appear in nothing the ledger keeps but an answer
const READ_TEXT = 'the lighthouse keeper counted seven gulls';
const LISTED_NAME = 'harbour-charts-invented';
const SAVED_TEXT = 'a tide table nobody has written before';

/** An endpoint whose services answer the four over a scratch folder: the read's text, a listing's name, a choice, a real save. */
async function setup() {
  const f = await startEndpoint(org, started);
  f.spine.set(APP, `eng-${APP}`, { appId: APP });
  f.records.set({ lane: 'B', session: `eng-${APP}`, owners: [org.A], access: 'private' }, APP);
  const folder = mkdtempSync(join(tmpdir(), 'u6f-ledger-'));
  dirs.push(folder);
  const file = join(folder, 'notes.txt');
  writeFileSync(file, 'as it was\n');
  const writes: string[] = [];
  f.spine.handle('files.readOutside', () => ({ encoding: 'utf8', content: READ_TEXT, bytes: READ_TEXT.length, offset: 0, length: READ_TEXT.length, truncated: false, mime: 'text/plain', hash: null, utf8: null, named: true, outside: { real: file, writable: true } }));
  f.spine.handle('files.listOutside', () => ({ status: 'listed', path: folder, parent: tmpdir(), home: tmpdir(), entries: [{ name: LISTED_NAME, path: join(folder, LISTED_NAME), kind: 'dir', protected: false }], cursor: null }));
  f.spine.handle('files.chooseOutside', () => ({ status: 'granted', path: file }));
  f.spine.handle('files.writeOutside', (input) => {
    const { content } = input as { content: string };
    writes.push(content);
    writeFileSync(file, content);
    return { status: 'ok', hash: 'c'.repeat(64) };
  });
  const a = await openRemote(f, org.a1, org.A);
  const ledger = () => readFileSync(join(f.services.machine.stateDir, 'spine-ops.jsonl'), 'utf8');
  const args: Record<string, Record<string, unknown>> = {
    'files.readOutside': { appSessionId: APP, path: file },
    'files.listOutside': { appSessionId: APP, path: folder },
    'files.chooseOutside': { appSessionId: APP, path: file },
    'files.writeOutside': { appSessionId: APP, path: file, content: SAVED_TEXT, expectedHash: 'a'.repeat(64), real: file },
  };
  const action = (name: string): Action => a.device.action({ machine: f.ref, action: name, args: args[name]! });
  return { f, a, file, folder, writes, ledger, action };
}

async function run(r: Remote, action: Action): Promise<unknown> {
  const from = r.inbox.length;
  expect(await act(r, action)).toBe('ok');
  return done(r, action, from);
}

async function query(r: Remote, action: Action): Promise<Msg> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'query', opId: action.opId, opCreated: action.opCreated, executor: 'machine' });
  return waitFor(r, (m) => m.t === 'queried' && m.opId === action.opId, `the answer to a query of ${action.action}`, from);
}

const ran = (f: Fixture, name: string) => f.spine.claimed.filter((c) => c.name === name).length;
const records = (text: string) => text.trim().split('\n').map((line) => JSON.parse(line) as { opId: string; claim?: Record<string, unknown> });

describe('a read and a listing, met again', () => {
  it('answer the act’s own caller what ran, and a copy of the operation the marker, through the endpoint’s conversion, running nothing', async () => {
    const { f, a, action } = await setup();
    for (const name of ['files.readOutside', 'files.listOutside']) {
      const first = action(name);
      expect([name, await run(a, first)]).toEqual([name, { state: 'done', result: expect.any(Object) }]);
      expect([name, await run(a, a.device.reseal(first))]).toEqual([name, { state: 'failed', error: { code: 'internal', message: 'the answer was not kept: ask again', issues: { refusal: NOT_KEPT_REFUSAL } } }]);
      expect([name, ran(f, name)]).toEqual([name, 1]);
      expect([name, await query(a, first)]).toEqual([name, expect.objectContaining({ state: 'done' })]);
    }
    expect(NOT_KEPT_REFUSAL).toBe('not-kept');
  });

  it('leave none of what they answered in the ledger’s file, which holds their claims and sealed actions', async () => {
    const { a, action, ledger, file } = await setup();
    const read = (await run(a, action('files.readOutside'))) as { result: { content: string } };
    const listed = (await run(a, action('files.listOutside'))) as { result: { entries: Array<{ name: string }> } };
    // the bytes did cross, to the act's own caller
    expect(read.result.content).toBe(READ_TEXT);
    expect(listed.result.entries.map((e) => e.name)).toEqual([LISTED_NAME]);
    const text = ledger();
    expect(text).not.toContain(READ_TEXT);
    expect(text).not.toContain(LISTED_NAME);
    // the control: the file searched is the ledger of these operations, their sealed actions beside their claims
    const claims = records(text).filter((r) => r.claim !== undefined);
    expect(claims.map((r) => [r.claim!.name, r.claim!.action === undefined ? 'no action' : 'action'])).toEqual([
      ['files.readOutside', 'action'],
      ['files.listOutside', 'action'],
    ]);
    expect(text).toContain(JSON.stringify(file).slice(1, -1));
  });
});

describe('a save', () => {
  it('is written once: a copy of its operation answers the kept outcome and runs nothing', async () => {
    const { f, a, action, file, writes } = await setup();
    const save = action('files.writeOutside');
    const kept = { state: 'done', result: { status: 'ok', hash: 'c'.repeat(64) } };
    expect(await run(a, save)).toEqual(kept);
    expect(await run(a, a.device.reseal(save))).toEqual(kept);
    expect(ran(f, 'files.writeOutside')).toBe(1);
    expect(writes).toEqual([SAVED_TEXT]);
    expect(readFileSync(file, 'utf8')).toBe(SAVED_TEXT);
    expect(await query(a, save)).toEqual(expect.objectContaining({ state: 'done' }));
  });

  it('leaves neither its text nor its sealed action in the ledger’s file; a choice keeps its action', async () => {
    const { a, action, ledger } = await setup();
    await run(a, action('files.writeOutside'));
    await run(a, action('files.chooseOutside'));
    const text = ledger();
    expect(text).not.toContain(SAVED_TEXT);
    const claims = records(text).filter((r) => r.claim !== undefined);
    expect(claims.map((r) => [r.claim!.name, r.claim!.action === undefined ? 'no action' : 'action'])).toEqual([
      ['files.writeOutside', 'no action'],
      ['files.chooseOutside', 'action'],
    ]);
  });
});

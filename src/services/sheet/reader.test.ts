// Reading records on the machine that holds them (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §C,
// M1): the sessions of every record under a home (G1.c), each record read as a verified pair of `state.json` and the
// inbox's tail, and nothing read from a name that is not a session's or a directory that is not the record's own.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { modelOf } from '@shared/sheet/read';
import { SheetStateSchema } from '@shared/sheet/model';
import { listRecords, readRecord, recordIo, sheetRoot, type RecordIo } from './reader';

const FIXTURES = join(__dirname, '../../../test/fixtures/sheet/set/fixtures');
const CASES = readdirSync(FIXTURES).sort();
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const sessionOf = (name: string): string => (readJson(join(FIXTURES, name, 'case.json')) as { session: string }).session;

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-sheet-'));
  scratch.push(dir);
  return dir;
};
// A scratch home holding one side of a fixture, as sminos's own suite makes one (its `home`).
const homeOf = (name: string, side: 'before' | 'after'): string => {
  const home = tempDir();
  cpSync(join(FIXTURES, name, side), home, { recursive: true });
  return home;
};

const A = '5eed0000-0000-4000-8000-0000000000a1';
const B = '5eed0000-0000-4000-8000-0000000000b2';

describe('listRecords', () => {
  it('lists the session of every record under each side of every fixture of the pin', async () => {
    for (const name of CASES) {
      for (const side of ['before', 'after'] as const) {
        const home = join(FIXTURES, name, side);
        expect(await listRecords(home), `${name} ${side}`).toEqual(existsSync(home) ? [sessionOf(name)] : []);
      }
    }
  });

  it('skips what is not a record: the surfaces, the staging, the locks, a name that is no session id, a link, a directory with no state', async () => {
    const home = tempDir();
    const root = sheetRoot(home);
    for (const session of [B, A]) {
      mkdirSync(join(root, session), { recursive: true });
      writeFileSync(join(root, session, 'state.json'), '{}');
      writeFileSync(join(root, `${session}.lock`), '');
    }
    for (const name of ['surfaces', '.staging', 'not-a-session', A.toUpperCase().replace('A1', 'C3')]) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(join(root, name, 'state.json'), '{}');
    }
    mkdirSync(join(root, '5eed0000-0000-4000-8000-0000000000d4')); // no state.json
    const elsewhere = tempDir();
    writeFileSync(join(elsewhere, 'state.json'), '{}');
    symlinkSync(elsewhere, join(root, '5eed0000-0000-4000-8000-0000000000e5'));
    writeFileSync(join(root, '5eed0000-0000-4000-8000-0000000000f6'), '{}'); // a file, not a directory
    expect(await listRecords(home)).toEqual([A, B]);
  });

  it('lists nothing under a home with no sheet', async () => {
    expect(await listRecords(tempDir())).toEqual([]);
    expect(await listRecords(join(tempDir(), 'missing'))).toEqual([]);
  });
});

describe('readRecord', () => {
  it('reads every side of every fixture of the pin as its show.*.json, in place', async () => {
    for (const name of CASES) {
      for (const side of ['before', 'after'] as const) {
        const want = readJson(join(FIXTURES, name, `show.${side}.json`));
        const got = await readRecord(join(FIXTURES, name, side), sessionOf(name));
        expect(got, `${name} ${side}`).toStrictEqual(want === null ? null : { model: want });
      }
    }
  });

  it('says a record this build cannot read is unreadable, and reads no record where there is none', async () => {
    const home = homeOf('references', 'before');
    const session = sessionOf('references');
    const path = join(sheetRoot(home), session, 'state.json');
    const state = readJson(path) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...state, v: 2 }));
    expect(await readRecord(home, session)).toEqual({ unreadable: expect.any(String) });
    writeFileSync(path, '{"v": 1, "session"');
    expect(await readRecord(home, session)).toEqual({ unreadable: expect.any(String) });
    writeFileSync(path, JSON.stringify({ ...state, questions: 'none' }));
    expect(await readRecord(home, session)).toEqual({ unreadable: expect.any(String) });
    rmSync(path);
    expect(await readRecord(home, session)).toBeNull();
    expect(await readRecord(tempDir(), session)).toBeNull();
  });

  it('reads an inbox that is missing, or shorter than the offset, as no tail', async () => {
    const home = homeOf('references', 'before');
    const session = sessionOf('references');
    const record = join(sheetRoot(home), session);
    const state = readJson(join(record, 'state.json')) as { inbox: { offset: number } };
    writeFileSync(join(record, 'state.json'), JSON.stringify({ ...state, inbox: { ...state.inbox, offset: 4096 } }));
    const short = await readRecord(home, session);
    expect(short !== null && 'model' in short && short.model.sent).toEqual([]);
    rmSync(join(record, 'inbox.jsonl'));
    const none = await readRecord(home, session);
    expect(none !== null && 'model' in none && none.model.sent).toEqual([]);
  });

  it('reads nothing, and touches no path, for a name that is not a session id', async () => {
    const touched: string[] = [];
    const spy: RecordIo = {
      entry: async (path) => (touched.push(path), recordIo.entry(path)),
      readState: async (path) => (touched.push(path), recordIo.readState(path)),
      readTail: async (path, offset) => (touched.push(path), recordIo.readTail(path, offset)),
      stat: async (path) => (touched.push(path), recordIo.stat(path)),
    };
    const home = homeOf('references', 'before');
    for (const name of ['..', '.', '', `${sessionOf('references')}/../${sessionOf('references')}`, 'a/b', sessionOf('references').toUpperCase(), `${sessionOf('references')}\n`]) {
      expect(await readRecord(home, name, spy), JSON.stringify(name)).toBeNull();
    }
    expect(touched).toEqual([]);
  });

  it('reads no record through a link, nor a state that is not a regular file', async () => {
    const home = tempDir();
    const elsewhere = homeOf('references', 'before');
    const session = sessionOf('references');
    mkdirSync(sheetRoot(home));
    symlinkSync(join(sheetRoot(elsewhere), session), join(sheetRoot(home), session));
    expect(await readRecord(home, session)).toBeNull();
    expect(await listRecords(home)).toEqual([]);

    const record = join(sheetRoot(elsewhere), session);
    const real = join(elsewhere, 'state.json');
    cpSync(join(record, 'state.json'), real);
    rmSync(join(record, 'state.json'));
    symlinkSync(real, join(record, 'state.json'));
    const read = await readRecord(elsewhere, session);
    expect(read).toEqual({ unreadable: expect.any(String) });
    expect(JSON.stringify(read)).not.toContain(elsewhere); // a reason a window may show names no path
  });

  it('marks a reference changed by its file’s size and modification time, to the millisecond', async () => {
    const home = homeOf('references', 'before');
    const session = sessionOf('references');
    const path = join(sheetRoot(home), session, 'state.json');
    const state = readJson(path) as { questions: { references: Record<string, unknown>[] }[] };
    const file = join(home, 'here.ts');
    writeFileSync(file, 'x\n');
    const st = statSync(file, { bigint: true });
    Object.assign(state.questions[0].references[0], { abs: file, size: Number(st.size), mtimeMs: Number(st.mtimeNs / 1_000_000n) });
    writeFileSync(path, JSON.stringify(state));
    const changes = async () => {
      const read = await readRecord(home, session);
      if (read === null || !('model' in read)) throw new Error('the record was read');
      return read.model.open[0].references.map((reference) => reference.changed);
    };
    expect(await changes()).toEqual([false, true, true]);
    writeFileSync(file, 'y\n', { flag: 'a' });
    expect((await changes())[0]).toBe(true);
    rmSync(file);
    expect((await changes())[0]).toBe(true);
  });
});

describe('readRecord’s verified pair', () => {
  const name = 'retract-unseen-late';

  it('answers busy after eight reads of the state when seq moves at every read, and returns no model', async () => {
    const home = homeOf(name, 'before');
    let reads = 0;
    const moving: RecordIo = {
      ...recordIo,
      readState: async (path) => {
        const state = (await recordIo.readState(path)) as Record<string, unknown>;
        reads += 1;
        return { ...state, seq: reads };
      },
    };
    expect(await readRecord(home, sessionOf(name), moving)).toEqual({ busy: true });
    expect(reads).toBe(8); // state, inbox, state again, four times
  });

  it('reads the pair that stood, and nothing of the tail read under the state that moved', async () => {
    const home = homeOf('references', 'before');
    const session = sessionOf('references');
    const record = join(sheetRoot(home), session);
    const before = readJson(join(record, 'state.json')) as { seq: number; inbox: { offset: number } };
    const length = statSync(join(record, 'inbox.jsonl')).size;
    expect(before.inbox.offset).toBeLessThan(length); // a queued answer stands in the first tail
    const after = { ...before, seq: before.seq + 1, inbox: { ...before.inbox, offset: length } };
    const states = [before];
    const tails: number[] = [];
    const io: RecordIo = {
      ...recordIo,
      readState: async () => structuredClone(states.shift() ?? after),
      readTail: async (path, offset) => (tails.push(offset), recordIo.readTail(path, offset)),
    };
    const read = await readRecord(home, session, io);
    expect(tails).toEqual([before.inbox.offset, length]);
    expect(read).toEqual({ model: modelOf(SheetStateSchema.parse(after), new Uint8Array(), () => true) });
    expect(read !== null && 'model' in read && read.model.sent.filter((entry) => entry.state === 'queued')).toEqual([]);
  });
});

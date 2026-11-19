// The one place MAWS opens the to-human mod's file of fold summaries (the UX wave, U2b: Interfaces §M, "The file: a
// contract, and its reader"; M4's sequences for the summary). The reader takes a session, never a path: the file's name
// is the session's engine session id as the index records it, under the engine's configuration directory. Whatever it
// cannot read answers `runs: null`; no file, and no engine session id yet, answer an empty list. Every file is invented.
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open as openFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { FOLDS_FILE_MAX_BYTES } from '@shared/owner/folds';
import { storedFolds, type StoredFoldsDeps } from './folds';

const APP = 'app-folds' as AppSessionId;
const ENGINE = '3c9d1e2f-4a5b-4c6d-8e7f-90a1b2c3d4e5';
const shape2 = (runs: [string, string, string][]) => JSON.stringify({ shape: 2, runs });

describe('storedFolds', () => {
  let root: string;
  let configHome: string;
  let engineSessionId: string | null;
  let record: boolean;
  let opened: string[];
  let between: (() => void) | null;
  const folds = () => join(configHome, 'to-human', 'folds');
  const put = (text: string | Buffer, name = `${ENGINE}.json`) => {
    mkdirSync(folds(), { recursive: true });
    writeFileSync(join(folds(), name), text);
  };
  const deps = (over: Partial<StoredFoldsDeps> = {}): StoredFoldsDeps => ({
    sessions: { get: (id) => (record && id === APP ? ({ appId: APP, engineSessionId } as unknown as SessionRecord) : null) },
    configHome: async () => configHome,
    open: async (path) => {
      opened.push(path);
      const handle: FileHandle = await openFile(path, 'r');
      between?.(); // the order held open: what happens to the file between the reader's open and its read
      return handle;
    },
    ...over,
  });

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-owner-folds-')));
    configHome = join(root, 'engine-config');
    engineSessionId = ENGINE;
    record = true;
    opened = [];
    between = null;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('answers the runs of a shape 2 file, opening that one name and nothing beside it', async () => {
    put(shape2([['toolu_1', 'toolu_4', 'Fixed the date parser; 212 tests pass']]));
    put('{"shape":2,"runs":[["x","y","A temporary"]]}', `${ENGINE}.json.k3j2.tmp`); // a writer's temporary, never read
    expect(await storedFolds(deps(), APP)).toEqual({ runs: [{ first: 'toolu_1', last: 'toolu_4', summary: 'Fixed the date parser; 212 tests pass' }] });
    expect(opened).toEqual([join(folds(), `${ENGINE}.json`)]);
  });

  it('answers an empty list with no file, and with no engine session id yet (nothing opened)', async () => {
    expect(await storedFolds(deps(), APP)).toEqual({ runs: [] });
    engineSessionId = null;
    opened = [];
    expect(await storedFolds(deps(), APP)).toEqual({ runs: [] });
    expect(opened).toEqual([]);
  });

  it('answers an empty list for a session the index has no record of, and null when the index cannot be read', async () => {
    record = false;
    expect(await storedFolds(deps(), APP)).toEqual({ runs: [] });
    const broken = deps({ sessions: { get: () => { throw new Error('the index is closed'); } } });
    expect(await storedFolds(broken, APP)).toEqual({ runs: null });
    expect(opened).toEqual([]);
  });

  it('answers null for shape 1, which releases before the mod’s pull request write, and for any other shape', async () => {
    put(JSON.stringify({ shape: 1, runs: [['a', 'b', 'Ran it']] }));
    expect(await storedFolds(deps(), APP)).toEqual({ runs: null });
    put(JSON.stringify({ shape: 3, runs: [] }));
    expect(await storedFolds(deps(), APP)).toEqual({ runs: null });
  });

  it('answers null for a text that does not parse, and the runs at the next read once the file is whole', async () => {
    put('{"shape":2,"runs":[["toolu_1","toolu_2","Ran the');
    expect(await storedFolds(deps(), APP)).toEqual({ runs: null });
    put(shape2([['toolu_1', 'toolu_2', 'Ran the suite']]));
    expect(await storedFolds(deps(), APP)).toEqual({ runs: [{ first: 'toolu_1', last: 'toolu_2', summary: 'Ran the suite' }] });
  });

  it('answers null for a file past 4 MiB, and reads one at the limit', async () => {
    const padded = (size: number) => {
      const body = shape2([['toolu_1', 'toolu_2', 'Ran it']]);
      return `${body}${' '.repeat(size - Buffer.byteLength(body))}`;
    };
    put(padded(FOLDS_FILE_MAX_BYTES));
    expect(await storedFolds(deps(), APP)).toEqual({ runs: [{ first: 'toolu_1', last: 'toolu_2', summary: 'Ran it' }] });
    put(padded(FOLDS_FILE_MAX_BYTES + 1));
    expect(await storedFolds(deps(), APP)).toEqual({ runs: null });
  });

  it('answers the old file whole when the contract’s rename replaces it between the open and the read', async () => {
    put(shape2([['toolu_1', 'toolu_2', 'The older summary']]));
    between = () => {
      writeFileSync(join(folds(), `${ENGINE}.json.n1.tmp`), shape2([['toolu_1', 'toolu_2', 'The newer summary'], ['toolu_5', 'toolu_6', 'One more run']]));
      renameSync(join(folds(), `${ENGINE}.json.n1.tmp`), join(folds(), `${ENGINE}.json`));
      between = null;
    };
    expect(await storedFolds(deps(), APP)).toEqual({ runs: [{ first: 'toolu_1', last: 'toolu_2', summary: 'The older summary' }] });
    // and the next read, the new one whole
    expect(await storedFolds(deps(), APP)).toEqual({
      runs: [{ first: 'toolu_1', last: 'toolu_2', summary: 'The newer summary' }, { first: 'toolu_5', last: 'toolu_6', summary: 'One more run' }],
    });
    expect(readdirSync(folds())).toEqual([`${ENGINE}.json`]);
  });

  it('never opens a path outside the folds folder: an engine session id that is no plain file name answers null', async () => {
    mkdirSync(configHome, { recursive: true });
    writeFileSync(join(configHome, 'settings.json'), shape2([['a', 'b', 'Not a folds file']]));
    for (const id of ['../../settings', '../settings', '..', 'a/b', '/etc/passwd', '', 'x'.repeat(129)]) {
      engineSessionId = id;
      expect(await storedFolds(deps(), APP), JSON.stringify(id)).toEqual({ runs: null });
    }
    expect(opened).toEqual([]);
  });

  it('answers null when the file cannot be read (a folder in its place)', async () => {
    mkdirSync(join(folds(), `${ENGINE}.json`), { recursive: true });
    expect(await storedFolds(deps(), APP)).toEqual({ runs: null });
  });
});

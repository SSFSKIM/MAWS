// The search for a file the transcript names, its memory and its queue (UX wave U6c,
// docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §B and the sequences S4 to S15). Every
// transcript here is made of invented records, written into a scratch store.
import { execFileSync } from 'node:child_process';
import { closeSync, constants, openSync, readdirSync, readFileSync } from 'node:fs';
import { open as fsOpen, readFile, rename, writeFile, mkdir, stat, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { callClass, rowClaim } from '@shared/files/named';
import { StoreFixture } from '../../../test/support/store-fixture';
import { createNamedPaths, NAMED_CHUNK_BYTES, NAMED_FINGERPRINT_BYTES, NAMED_ROW_BYTES, NAMED_SCAN_BYTES, NAMED_WAIT_MS, NAMED_WAITING_MAX, NAMED_CACHE_ENTRIES, NAMED_PENDING_MAX, NAMED_CLAIM_STEPS, NAMED_PATH_MAX, type NamedPathsOptions } from './named';

const S = 'app-named' as AppSessionId;
const P = '/work/out/report.md';
const FP = NAMED_FINGERPRINT_BYTES;

// Records in the shapes the engine writes (test/fixtures/transcripts/), invented.
let serial = 0;
const text = (value: string) => ({ type: 'text', text: value });
const assistant = (...content: object[]) => ({ type: 'assistant', uuid: `a-${++serial}`, message: { role: 'assistant', content } });
const call = (id: string, name: string, input: object) => assistant({ type: 'tool_use', id, name, input });
const user = (content: string | object[], extra: object = {}) => ({ type: 'user', uuid: `u-${++serial}`, message: { role: 'user', content }, ...extra });
const result = (id: string, content: string | object[], extra: object = {}) => user([{ type: 'tool_result', tool_use_id: id, content }], extra);
const filler = (n: number, size = 200) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? user(`note ${i} ${'x'.repeat(size)}`) : assistant(text(`reply ${i} ${'y'.repeat(size)}`))));
const linkTo = (path: string) => assistant(text(`Wrote [the report](${path}).`));
const lineOf = (record: object) => JSON.stringify(record);
const bytesOf = (records: object[]) => records.reduce((sum, record) => sum + Buffer.byteLength(lineOf(record)) + 1, 0);

let fixture: StoreFixture;
let file: string | null;
let holds: Partial<Record<'opened' | 'searched', () => Promise<void>>>;
let failRead: ((n: number) => boolean) | null;
const stats = { opens: 0, reads: 0, bytes: 0 };

// fs.open with every read counted, and a read that fails on request
const counting: NonNullable<NamedPathsOptions['open']> = async (path, flags) => {
  const handle = await fsOpen(path, flags);
  stats.opens += 1;
  const read = handle.read.bind(handle) as (buffer: Buffer, offset: number, length: number, position: number) => Promise<{ bytesRead: number; buffer: Buffer }>;
  Object.assign(handle, {
    read: async (buffer: Buffer, offset: number, length: number, position: number) => {
      stats.reads += 1;
      if (failRead?.(stats.reads)) throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' });
      const answer = await read(buffer, offset, length, position);
      stats.bytes += answer.bytesRead;
      return answer;
    },
  });
  return handle;
};
const reset = () => Object.assign(stats, { opens: 0, reads: 0, bytes: 0 });

function paths(extra: Partial<NamedPathsOptions> = {}) {
  return createNamedPaths({
    transcript: async () => file,
    open: counting,
    hooks: {
      at: async (point) => {
        const hold = holds[point];
        if (!hold) return;
        delete holds[point]; // each hold runs once
        await hold();
      },
    },
    ...extra,
  });
}

async function writeTranscript(records: object[]): Promise<string> {
  file = await fixture.addTranscript('/work/repo', 'engine-session-1', records.map(lineOf));
  return file;
}
// Rewritten in place: the same inode, other bytes.
const rewriteInPlace = (records: object[]) => writeFile(file!, records.map((record) => `${lineOf(record)}\n`).join(''));
const append = (records: object[]) => fixture.appendLines(file!, records.map(lineOf));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
// A hold at `point` that says when it is reached and waits for the test's release.
function holdAt(point: 'opened' | 'searched', during?: () => Promise<void>) {
  const reached = deferred();
  const release = deferred();
  holds[point] = async () => {
    reached.resolve();
    await release.promise;
    await during?.();
  };
  return { reached: reached.promise, release: release.resolve };
}
const turns = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
// An open whose reads answer at once from the file's bytes as they were at the open, with no wait on the file system,
// each read noting `onRead` first: the loop then turns only where the search gives it back (fix round 1, item 4).
function instant(onRead: () => void = () => {}): NonNullable<NamedPathsOptions['open']> {
  return async (path) => {
    const bytes = await readFile(path);
    const status = await stat(path, { bigint: true });
    return {
      stat: async () => status,
      read: (buffer: Buffer, offset: number, length: number, position: number) => {
        onRead();
        const n = Math.max(0, Math.min(length, bytes.length - position));
        bytes.copy(buffer, offset, position, position + n);
        return Promise.resolve({ bytesRead: n, buffer });
      },
      close: async () => {},
    } as unknown as FileHandle;
  };
}
// A ticker on the loop's check phase: `ticks()` is how many turns it has had since `start`.
function ticker() {
  let count = 0;
  let done = false;
  const tick = () => {
    count += 1;
    if (!done) setImmediate(tick);
  };
  setImmediate(tick);
  return { ticks: () => count, stop: () => void (done = true) };
}

beforeEach(async () => {
  fixture = await StoreFixture.create();
  file = null;
  holds = {};
  failRead = null;
  reset();
});
afterEach(async () => {
  await fixture.dispose();
});

describe('the bounds', () => {
  it('are the document’s', () => {
    expect({ NAMED_SCAN_BYTES, NAMED_CHUNK_BYTES, NAMED_ROW_BYTES, NAMED_CACHE_ENTRIES, NAMED_WAITING_MAX, NAMED_WAIT_MS, NAMED_FINGERPRINT_BYTES, NAMED_PENDING_MAX, NAMED_CLAIM_STEPS, NAMED_PATH_MAX }).toEqual({
      NAMED_SCAN_BYTES: 1024 ** 3,
      NAMED_CHUNK_BYTES: 1024 * 1024,
      NAMED_ROW_BYTES: 4 * 1024 * 1024,
      NAMED_CACHE_ENTRIES: 256,
      NAMED_WAITING_MAX: 8,
      NAMED_WAIT_MS: 8_000,
      NAMED_FINGERPRINT_BYTES: 4096,
      NAMED_PENDING_MAX: 256,
      NAMED_CLAIM_STEPS: 64,
      NAMED_PATH_MAX: 4096,
    });
  });
});

describe('names: what the transcript names', () => {
  it('a link in the newest rows names the path; one nowhere names nothing', async () => {
    await writeTranscript([...filler(10), linkTo(P), ...filler(2)]);
    const named = paths();
    expect(await named.names(S, P)).toBe(true);
    expect(await named.names(S, '/work/out/other.md')).toBe(false);
  });

  it('every counted place names the path, through the search', async () => {
    const cases: object[][] = [
      [user(`Open [r](${P})`)],
      [user([text(`Open [r](${P})`)])],
      [{ type: 'attachment', uuid: 'q1', attachment: { type: 'queued_command', prompt: `Open [r](${P})`, source_uuid: 's1', commandMode: 'prompt', origin: { kind: 'human' } } }],
      [call('t1', 'ExitPlanMode', { plan: `Then [r](${P})` })],
      [call('t1', 'Read', { file_path: P })],
      [call('t1', 'Edit', { file_path: P, old_string: 'a', new_string: 'b' })],
      [call('t1', 'mcp__docs__save', { title: 'r' }), ...filler(3), result('t1', `Saved to [r](${P})`)],
      [call('t1', 'Write', { file_path: '/work/out/elsewhere.md', content: 'x' }), ...filler(3), result('t1', 'File created', { toolUseResult: { type: 'create', filePath: P } })],
    ];
    for (const records of cases) {
      await writeTranscript([...filler(4), ...records, ...filler(4)]);
      expect(await paths().names(S, P), JSON.stringify(records)).toBe(true);
    }
  });

  it('a result form names nothing without its call, or with a call of another tool', async () => {
    const cases: object[][] = [
      [...filler(3), result('t1', `Saved to [r](${P})`)],
      [call('t1', 'Bash', { command: 'make' }), ...filler(3), result('t1', `Saved to [r](${P})`)],
      [call('t1', 'Bash', { command: 'make' }), ...filler(3), result('t1', 'ok', { toolUseResult: { filePath: P } })],
      [result('t1', `Saved to [r](${P})`), call('t1', 'mcp__docs__save', {})], // the call is older than its result
      [call('t1', 'Bash', { command: `ls ${P}` }), result('t1', `[r](${P})`, { toolUseResult: { stdout: `[r](${P})` } })],
    ];
    for (const records of cases) {
      await writeTranscript([...filler(4), ...records, ...filler(4)]);
      expect(await paths().names(S, P), JSON.stringify(records)).toBe(false);
    }
  });

  it('records that hold the link but do not count name nothing', async () => {
    await writeTranscript([
      { type: 'queue-operation', operation: 'enqueue', content: `Open [r](${P})` },
      { type: 'api-request', messages: [{ role: 'assistant', content: `[r](${P})` }] },
      user(`[r](${P})`, { isMeta: true }),
      user(`[r](${P})`, { isCompactSummary: true }),
      assistant(text(`a bare ${P} in prose`)),
      { type: 'summary', summary: `[r](${P})` },
    ]);
    expect(await paths().names(S, P)).toBe(false);
  });

  // the branch review's finding 1, through the search: a link inside a link's destination or title names nothing
  it('a path written inside another link’s destination or title is not named; the outer destination is', async () => {
    const outer = '/vault/[x](/secret).txt';
    await writeTranscript([...filler(4), assistant(text('[r](</vault/[x](/secret).txt>)')), assistant(text('[r](/work/out/a.md "see [x](/secret)")')), ...filler(4)]);
    const named = paths();
    expect(await named.names(S, '/secret')).toBe(false);
    expect(await named.names(S, outer)).toBe(true);
  });

  it('a hit before a compaction boundary still names the path', async () => {
    await writeTranscript([linkTo(P), ...filler(4), { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }, user('Summary of the conversation so far', { isCompactSummary: true }), ...filler(4)]);
    expect(await paths().names(S, P)).toBe(true);
  });

  it('a name with a quote, a backslash, a space and non-ASCII letters is found', async () => {
    const odd = '/work/out/say "hi" \\x 보고서.md';
    await writeTranscript([...filler(4), assistant(text(`See [it](<${odd}>).`)), ...filler(4)]);
    expect(await paths().names(S, odd)).toBe(true);
  });

  it('a record older than the bound is not named; one wholly inside it is', async () => {
    const records = [linkTo(P), ...filler(20)];
    await writeTranscript(records);
    const after = bytesOf(records.slice(1));
    expect(await paths({ bounds: { scan: after } }).names(S, P)).toBe(false);
    expect(await paths({ bounds: { scan: after + Buffer.byteLength(lineOf(records[0]!)) + 1 } }).names(S, P)).toBe(true);
  });

  it('a line longer than the row bound is passed over', async () => {
    const long = assistant(text(`[r](${P}) ${'z'.repeat(9_000)}`));
    await writeTranscript([...filler(2), long, ...filler(2)]);
    expect(await paths({ bounds: { row: 8_000, chunk: 1_000 } }).names(S, P)).toBe(false);
    expect(await paths({ bounds: { row: 10_000, chunk: 1_000 } }).names(S, P)).toBe(true);
  });

  it('a last line with no end is not read, and is searched once it is whole', async () => {
    await writeTranscript(filler(4));
    await fixture.appendBytes(file!, Buffer.from(lineOf(linkTo(P))));
    const named = paths();
    expect(await named.names(S, P)).toBe(false);
    await fixture.appendBytes(file!, Buffer.from('\n'));
    expect(await named.names(S, P)).toBe(true);
  });

  it('no transcript, no file, a directory or a locator that throws: not named, and nothing thrown', async () => {
    expect(await paths().names(S, P)).toBe(false);
    expect(stats.opens).toBe(0);
    file = join(fixture.configHome, 'projects', 'nowhere', 'gone.jsonl');
    expect(await paths().names(S, P)).toBe(false);
    file = join(fixture.configHome, 'projects');
    expect(await paths().names(S, P)).toBe(false);
    expect(await paths({ transcript: () => Promise.reject(new Error('index closed')) }).names(S, P)).toBe(false);
  });

  // the branch review's finding 6: a located transcript that is not a regular file is refused before any read; opened
  // without blocking, a FIFO with no writer cannot hold the daemon's one search slot
  it('a transcript that is a FIFO answers not named at once, and the next search runs', async () => {
    await writeTranscript([linkTo(P)]);
    const fifo = join(dirname(file!), 'fifo.jsonl');
    execFileSync('mkfifo', [fifo]);
    const piped = 'app-fifo' as AppSessionId;
    const named = paths({ transcript: async (appSessionId) => (appSessionId === piped ? fifo : file), bounds: { waitMs: 1_000 } });
    try {
      const started = performance.now();
      expect(await named.names(piped, P)).toBe(false);
      expect(performance.now() - started).toBeLessThan(1_000); // answered, not given up on
      expect(await named.names(S, P)).toBe(true);
    } finally {
      closeSync(openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK)); // releases an open still waiting for a writer
    }
  });

  it('an ask whose signal has already ended answers at once and opens nothing', async () => {
    await writeTranscript([linkTo(P)]);
    expect(await paths().names(S, P, AbortSignal.abort())).toBe(false);
    expect(stats.opens).toBe(0);
  });
});

describe('what a remembered answer costs, and what it rests on (A8)', () => {
  it('a path found in the newest rows is found without reading the older ones', async () => {
    const records = [...filler(300), linkTo(P)];
    await writeTranscript(records);
    expect(await paths({ bounds: { chunk: 4096 } }).names(S, P)).toBe(true);
    expect(bytesOf(records)).toBeGreaterThan(50_000);
    expect(stats.bytes).toBeLessThan(5 * 4096); // a chunk, two fingerprints' worth at most, and the proof
  });

  it('after a hit, a later ask reads the naming record’s bytes again and no more', async () => {
    const naming = linkTo(P);
    await writeTranscript([...filler(50), naming, ...filler(5)]);
    const named = paths();
    expect(await named.names(S, P)).toBe(true);
    reset();
    expect(await named.names(S, P)).toBe(true);
    expect(stats.bytes).toBe(Buffer.byteLength(lineOf(naming)) + 2); // the line, the byte before and the byte after
  });

  it('after a hit that rests on a result, a later ask reads the two records again and no more', async () => {
    const records = [call('t1', 'mcp__docs__save', { title: 'r' }), ...filler(10), result('t1', `Saved to [r](${P})`), ...filler(3)];
    await writeTranscript([...filler(5), ...records]);
    const named = paths();
    expect(await named.names(S, P)).toBe(true);
    reset();
    expect(await named.names(S, P)).toBe(true);
    expect(stats.bytes).toBe(Buffer.byteLength(lineOf(records[0]!)) + 2 + Buffer.byteLength(lineOf(records[11]!)) + 2);
  });

  it('after a miss, only what was written since is searched', async () => {
    await writeTranscript(filler(500));
    const before = (await stat(file!)).size;
    const named = paths({ bounds: { chunk: 4096 } });
    expect(await named.names(S, P)).toBe(false);
    const added = [...filler(5), linkTo(P), ...filler(5)];
    await append(added);
    reset();
    expect(await named.names(S, P)).toBe(true);
    expect(before).toBeGreaterThan(100_000);
    // what was added, and three fingerprints (the miss's, and the new checkpoint's twice)
    expect(stats.bytes).toBeLessThanOrEqual(bytesOf(added) + 3 * 2 * FP + 2 * 4096);
  });

  it('a miss with nothing written since reads its fingerprint and nothing of the transcript', async () => {
    await writeTranscript(filler(500));
    const named = paths();
    expect(await named.names(S, P)).toBe(false);
    reset();
    expect(await named.names(S, P)).toBe(false);
    expect(stats.bytes).toBe(2 * FP); // the checkpoint's fingerprint, proven again and kept
  });

  it('keeps the least recently asked entries within its bound', async () => {
    const other = '/work/out/other.md';
    await writeTranscript([linkTo(P), linkTo(other), ...filler(100)]);
    const named = paths({ bounds: { entries: 1 } });
    expect(await named.names(S, P)).toBe(true);
    expect(await named.names(S, other)).toBe(true);
    reset();
    expect(await named.names(S, P)).toBe(true);
    expect(stats.bytes).toBeGreaterThan(bytesOf(filler(100))); // P's entry was dropped: searched again
  });
});

describe('the sequences (S4 to S13)', () => {
  it('S4: the transcript grows while it is searched; the ask answers for the file as it was, the next searches what was added', async () => {
    await writeTranscript(filler(20));
    const named = paths();
    const held = holdAt('opened', () => append([linkTo(P)]));
    const asked = named.names(S, P);
    await held.reached;
    held.release();
    expect(await asked).toBe(false);
    expect(await named.names(S, P)).toBe(true);
  });

  it('S4: growth seen only after the search does not change its answer', async () => {
    await writeTranscript(filler(20));
    const named = paths();
    const held = holdAt('searched', () => append([linkTo(P)]));
    const asked = named.names(S, P);
    await held.reached;
    held.release();
    expect(await asked).toBe(false);
    expect(await named.names(S, P)).toBe(true);
  });

  it('S5: a transcript renamed into another folder between two asks: the hit is proven at the new place and stands', async () => {
    const naming = linkTo(P);
    await writeTranscript([...filler(20), naming, ...filler(2)]);
    const named = paths();
    expect(await named.names(S, P)).toBe(true);
    const moved = join(fixture.configHome, 'projects', 'another-folder', 'engine-session-1.jsonl');
    await mkdir(dirname(moved), { recursive: true });
    await rename(file!, moved);
    file = moved;
    reset();
    expect(await named.names(S, P)).toBe(true);
    expect(stats.bytes).toBe(Buffer.byteLength(lineOf(naming)) + 2);
  });

  it('S6: a transcript at neither place for a moment: not named, nothing thrown, and found again once it is back', async () => {
    const path = await writeTranscript([linkTo(P)]);
    const named = paths();
    file = `${path}.moving`;
    expect(await named.names(S, P)).toBe(false);
    file = path;
    expect(await named.names(S, P)).toBe(true);
  });

  it('S7: two asks for one session and path at once share one job', async () => {
    await writeTranscript([...filler(20), linkTo(P)]);
    const locate = vi.fn(async () => file);
    const named = paths({ transcript: locate });
    expect(await Promise.all([named.names(S, P), named.names(S, P)])).toEqual([true, true]);
    expect(locate).toHaveBeenCalledTimes(2); // each request finds its session's transcript before it joins a job
    expect(stats.opens).toBe(1);
  });

  // the branch review's finding 5: `/clear` keeps the app session id and binds it to a new transcript; a request made
  // after that never joins a search of the transcript the session had before
  it('a request made after the session is bound to another transcript does not join a search of the old one', async () => {
    const old = await writeTranscript([...filler(4), linkTo(P)]);
    const rebound = await fixture.addTranscript('/work/repo', 'engine-session-2', filler(4).map(lineOf));
    const named = paths({ transcript: async () => file });
    const held = holdAt('opened');
    const before = named.names(S, P);
    await held.reached;
    file = rebound; // the session's transcript is now another file, which does not link the path
    const after = named.names(S, P);
    held.release();
    expect(await before).toBe(true); // asked while the session was bound to the old transcript
    expect(await after).toBe(false); // answered as a fresh request is
    expect(await paths({ transcript: async () => rebound }).names(S, P)).toBe(false);
    expect(old).not.toBe(rebound);
  });

  it('S8: a search that fails in the middle names nothing and remembers nothing; the next ask searches again', async () => {
    await writeTranscript([linkTo(P), ...filler(100)]);
    const named = paths({ bounds: { chunk: 2048 } });
    failRead = (n) => n === 3;
    expect(await named.names(S, P)).toBe(false);
    failRead = null;
    reset();
    expect(await named.names(S, P)).toBe(true);
    expect(stats.bytes).toBeGreaterThan(bytesOf(filler(100))); // the whole transcript searched again
  });

  it('S9: rewritten in place to the same length without the naming record: proven, dropped, searched again, not named', async () => {
    const records = [...filler(10), linkTo(P), ...filler(10)];
    await writeTranscript(records);
    const named = paths();
    expect(await named.names(S, P)).toBe(true);
    const unnamed = linkTo('/work/out/rePort.md');
    unnamed.uuid = (records[10] as { uuid: string }).uuid;
    const rewritten = [...records.slice(0, 10), unnamed, ...records.slice(11)];
    expect(bytesOf(rewritten)).toBe(bytesOf(records));
    await rewriteInPlace(rewritten);
    expect(await named.names(S, P)).toBe(false);
  });

  it('S10: rewritten in place, longer, without the naming record: not named', async () => {
    const records = [...filler(10), linkTo(P), ...filler(10)];
    await writeTranscript(records);
    const named = paths();
    expect(await named.names(S, P)).toBe(true);
    await rewriteInPlace([...filler(40), assistant(text('nothing linked'))]);
    expect(await named.names(S, P)).toBe(false);
  });

  it('S11: rewritten while the search runs: a hit answers only if its record still names the path at the search’s end', async () => {
    const records = [...filler(3), linkTo(P), ...filler(3)];
    await writeTranscript(records);
    const named = paths();
    const unnamed = { ...linkTo('/work/out/rePort.md'), uuid: (records[3] as { uuid: string }).uuid };
    const held = holdAt('searched', () => rewriteInPlace([...records.slice(0, 3), unnamed, ...records.slice(4)]));
    const asked = named.names(S, P);
    await held.reached;
    held.release();
    expect(await asked).toBe(false);
  });

  it('S11: rewritten while the search runs: a miss is not remembered, so the next ask searches the whole window', async () => {
    const records = [...filler(3), linkTo('/work/out/rePort.md'), ...filler(3)];
    await writeTranscript(records);
    const named = paths();
    const naming = { ...linkTo(P), uuid: (records[3] as { uuid: string }).uuid };
    const held = holdAt('searched', () => rewriteInPlace([...records.slice(0, 3), naming, ...records.slice(4)]));
    const asked = named.names(S, P);
    await held.reached;
    held.release();
    expect(await asked).toBe(false);
    expect(await named.names(S, P)).toBe(true);
  });

  it('S12: after a miss, a rewrite that puts the link before the checkpoint fails the fingerprint, and the whole window is searched', async () => {
    const records = [...filler(3), linkTo('/work/out/rePort.md'), ...filler(3)];
    await writeTranscript(records);
    const named = paths();
    expect(await named.names(S, P)).toBe(false);
    await rewriteInPlace([...records.slice(0, 3), { ...linkTo(P), uuid: (records[3] as { uuid: string }).uuid }, ...records.slice(4)]);
    expect(await named.names(S, P)).toBe(true);
  });

  it('S13: a result added since a miss, whose call is older than the checkpoint, is named once its call is found', async () => {
    await writeTranscript([call('t1', 'mcp__docs__save', { title: 'r' }), call('t2', 'Edit', { file_path: '/work/out/x.md', old_string: 'a', new_string: 'b' }), ...filler(30)]);
    const named = paths({ bounds: { chunk: 1024 } });
    expect(await named.names(S, P)).toBe(false);
    expect(await named.names(S, '/work/out/edited.md')).toBe(false);
    await append([result('t1', `Saved to [r](${P})`), result('t2', 'ok', { toolUseResult: { filePath: '/work/out/edited.md' } })]);
    expect(await named.names(S, P)).toBe(true);
    expect(await named.names(S, '/work/out/edited.md')).toBe(true);
  });
});

describe('the queue (S14, S15)', () => {
  it('S14: one job runs, eight wait, a ninth distinct search is answered at once, and the others are unaffected', async () => {
    const others = Array.from({ length: 8 }, (_, i) => `/work/out/waiting-${i}.md`);
    await writeTranscript([linkTo(P), ...others.map(linkTo), ...filler(10)]);
    const named = paths();
    const held = holdAt('opened');
    const running = named.names(S, P);
    await held.reached;
    const waiting = others.map((path) => named.names(S, path));
    const sameAsWaiting = named.names(S, others[0]!); // joins a waiting job: no new one
    expect(await named.names(S, '/work/out/ninth.md')).toBe(false);
    expect(await named.names('app-other' as AppSessionId, P)).toBe(false); // another session's ask is a distinct job too
    held.release();
    expect(await running).toBe(true);
    expect(await Promise.all(waiting)).toEqual(others.map(() => true));
    expect(await sameAsWaiting).toBe(true);
  });

  it('S15: every waiter of the running search leaves; it stops at its next read and remembers nothing', async () => {
    const records = [linkTo(P), ...filler(200)];
    await writeTranscript(records);
    const named = paths({ bounds: { chunk: 4096 } });
    const controller = new AbortController();
    const held = holdAt('searched');
    const asked = named.names(S, P, controller.signal);
    await held.reached;
    controller.abort();
    expect(await asked).toBe(false);
    held.release();
    await turns();
    reset();
    expect(await named.names(S, P)).toBe(true);
    expect(stats.bytes).toBeGreaterThan(bytesOf(filler(200))); // nothing was remembered: the whole window again
  });

  it('S15: a running search left by its waiter reads nothing more', async () => {
    await writeTranscript([linkTo(P), ...filler(200)]);
    const named = paths({ bounds: { chunk: 4096 } });
    const controller = new AbortController();
    const held = holdAt('opened');
    const asked = named.names(S, P, controller.signal);
    await held.reached;
    controller.abort();
    expect(await asked).toBe(false);
    reset();
    held.release();
    await turns();
    expect(stats.bytes).toBe(0);
  });

  it('S15: a waiter whose patience runs out is answered not named; the job goes on for those still waiting', async () => {
    await writeTranscript([linkTo(P)]);
    const named = paths({ bounds: { waitMs: 30 } });
    const held = holdAt('opened');
    const impatient = named.names(S, P);
    await held.reached;
    expect(await impatient).toBe(false);
    held.release();
    expect(await named.names(S, P)).toBe(true);
  });

  it('a waiting job whose waiters all leave never runs', async () => {
    await writeTranscript([linkTo(P), linkTo('/work/out/second.md')]);
    const locate = vi.fn(async () => file);
    const named = paths({ transcript: locate });
    const held = holdAt('opened');
    const first = named.names(S, P);
    await held.reached;
    const controller = new AbortController();
    const second = named.names(S, '/work/out/second.md', controller.signal);
    await turns(2); // its transcript found, it waits behind the first
    controller.abort();
    expect(await second).toBe(false);
    held.release();
    expect(await first).toBe(true);
    await turns();
    expect(locate).toHaveBeenCalledTimes(2);
    expect(stats.opens).toBe(1); // the second job never opened its transcript
  });

  // fix round 1, item 4: with reads that answer at once, the loop turns between two reads only if the search gives it
  // back there (a count of turns over real reads also counts the loop turning while a read waits)
  it('gives the event loop back after every read', async () => {
    await writeTranscript([linkTo(P), ...filler(400)]);
    const loop = ticker();
    const at: number[] = []; // the loop's turns at each read
    try {
      expect(await paths({ open: instant(() => at.push(loop.ticks())), bounds: { chunk: 2048 } }).names(S, P)).toBe(true);
    } finally {
      loop.stop();
    }
    expect(at.length).toBeGreaterThan(20);
    for (let i = 1; i < at.length; i += 1) expect(at[i], `read ${i}`).toBeGreaterThan(at[i - 1]!);
  });

  // fix round 1, item 5: the walk of a tool input counts every value it visits, containers too, as a step
  it('gives the event loop back while it walks a tool input of a million empty objects', async () => {
    const empties = 1_000_000;
    await writeTranscript([call('t1', 'ExitPlanMode', { items: Array.from({ length: empties }, () => ({})), note: `[r](${P}.bak)` })]);
    const loop = ticker();
    try {
      expect(await paths({ open: instant() }).names(S, P)).toBe(false);
    } finally {
      loop.stop();
    }
    expect(loop.ticks()).toBeGreaterThanOrEqual(empties / 256); // at least one turn of the loop per 256 values
  });

  // Decision Log 24: the rule's meter pauses each time its scan has done 64 KiB of work, and each pause is a turn of the
  // loop at once, not one step among NAMED_CLAIM_STEPS. A row of one long text and one link that does not name the path:
  // its two passes over three million characters pause at least once per 64 KiB of the text. The turns are counted from
  // the moment the transcript is open, so none is the loop turning while the file is read from the disk.
  it('gives the event loop back at every pause of the scan of one long text', async () => {
    const text = `${'x'.repeat(3_000_000)} [r](${P}.bak)`;
    await writeTranscript([assistant({ type: 'text', text })]);
    const loop = ticker();
    let opened = 0;
    holds.opened = async () => void (opened = loop.ticks());
    try {
      expect(await paths({ open: instant(), bounds: { chunk: 8 * 1024 * 1024 } }).names(S, P)).toBe(false);
    } finally {
      loop.stop();
    }
    expect(loop.ticks() - opened).toBeGreaterThanOrEqual(text.length / (64 * 1024));
  });

  // The work meter's fix pass (the task review, item 2): `files.read` asks for a missing file's path too, which no
  // `realpath` has bounded and no schema caps; a path longer than NAMED_PATH_MAX (the largest PATH_MAX of the platforms)
  // is not named, at once, and its session's transcript is not looked for.
  it('a path longer than NAMED_PATH_MAX is not named, and the locator is never asked', async () => {
    const over = `/work/missing/${'d'.repeat(NAMED_PATH_MAX)}.md`;
    const under = `/work/missing/${'d'.repeat(NAMED_PATH_MAX - 20)}.md`;
    await writeTranscript([linkTo(over), linkTo(under)]);
    const locate = vi.fn(async () => file);
    expect(await paths({ transcript: locate }).names(S, over)).toBe(false);
    expect(locate).not.toHaveBeenCalled();
    expect(await paths().names(S, under)).toBe(true); // under the bound, a long path is read as any
  });

  // fix round 1, item 3: a request's patience and its signal run from the moment it is made, the locator's wait
  // included; the queue has only what is left; a locator that answers after the request ended queues nothing
  it('a held locator: the request answers not named on time, or at once when its signal ends, and queues nothing', async () => {
    await writeTranscript([linkTo(P)]);
    const located = deferred();
    const named = paths({ transcript: () => located.promise.then(() => file), bounds: { waitMs: 20 } });
    const late = Symbol('still pending');
    const within = (answer: Promise<boolean>, ms: number) => Promise.race([answer, new Promise<typeof late>((done) => setTimeout(() => done(late), ms))]);
    expect(await within(named.names(S, P), 500)).toBe(false);
    const controller = new AbortController();
    const aborted = named.names(S, P, controller.signal);
    controller.abort();
    expect(await within(aborted, 10)).toBe(false);
    located.resolve();
    await turns();
    expect(stats.opens).toBe(0); // neither request queued a job once the locator answered
  });

  it('the patience left after the locator answers is all the request waits in the queue', async () => {
    await writeTranscript([linkTo(P)]);
    const named = paths({ transcript: () => new Promise((done) => setTimeout(() => done(file), 300)), bounds: { waitMs: 400 } });
    const held = holdAt('opened');
    const asked = named.names('app-held' as AppSessionId, P); // holds the one job slot
    await held.reached;
    const started = performance.now();
    expect(await named.names(S, P)).toBe(false); // its own locator answers at 300 ms, the queue then has 100 ms
    expect(performance.now() - started).toBeLessThan(550); // not 300 ms and then 400 more
    held.release();
    expect(await asked).toBe(false); // its patience ran out while held
  });

  // the branch review's finding 2: one row under the row bound can hold a great many links, each read through the URL
  // step; the row is worked in bounded steps with the event loop given back between them, so the daemon's other work
  // runs before the row is done, and the work stops at the first link that names the path. Each URL the rule builds
  // records how many turns of the loop a ticker has had by then (a count of turns alone cannot tell: the loop also turns
  // while a read waits).
  describe('one row of many candidates', () => {
    const candidates = 20_000;
    let ticks = 0;
    let built: number[] = [];
    async function searched(row: object): Promise<boolean> {
      await writeTranscript([...filler(2), row]);
      ticks = 0;
      built = [];
      let done = false;
      const tick = () => {
        ticks += 1;
        if (!done) setImmediate(tick);
      };
      vi.stubGlobal(
        'URL',
        class extends URL {
          constructor(...args: ConstructorParameters<typeof URL>) {
            super(...args);
            built.push(ticks);
          }
        },
      );
      try {
        setImmediate(tick);
        return await paths().names(S, P);
      } finally {
        done = true;
        vi.unstubAllGlobals();
      }
    }

    it('gives the event loop back before the row is done', async () => {
      expect(await searched(assistant(text(`[r](${P}.bak) `.repeat(candidates))))).toBe(false);
      expect(built.length).toBeGreaterThanOrEqual(candidates);
      expect(built.at(-1)! - built[0]!).toBeGreaterThanOrEqual(candidates / 256); // at least one turn of the loop per 256 candidates
    });

    it('stops at the first link that names the path', async () => {
      expect(await searched(assistant(text(`[r](${P}) ${`[r](${P}.bak) `.repeat(candidates)}`)))).toBe(true);
      expect(built.length).toBeLessThan(candidates / 2); // the search's proof reads the row again, and stops at its first link too
    });
  });
});

// The results waiting for their calls (Decision Log 13): a line is checked against them in one pass, however many wait,
// and at most NAMED_PENDING_MAX of them wait; an older result past the cap is not waited for.
describe('the results waiting for their calls', () => {
  const unresolved = (n: number, tag: string) => Array.from({ length: n }, (_, i) => result(`toolu_${tag}${i}`, `Saved to [r](${P})`));

  it('a call is found by the bytes the engine writes for its id: `"id":"<id>"` in its tool_use block', () => {
    const fixtures = join(__dirname, '../../../test/fixtures/transcripts');
    let checked = 0;
    for (const name of readdirSync(fixtures).filter((entry) => entry.endsWith('.jsonl'))) {
      for (const line of readFileSync(join(fixtures, name), 'utf8').split('\n')) {
        let row: { type?: string; message?: { content?: unknown } };
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        if (row.type !== 'assistant' || !Array.isArray(row.message?.content)) continue;
        for (const block of row.message.content as { type?: string; id?: string }[]) {
          if (block.type !== 'tool_use') continue;
          expect(line).toContain(`"id":${JSON.stringify(block.id)}`);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('many results whose calls are never found cost one pass per line, not one search per waiting id', async () => {
    const n = 1000;
    await writeTranscript(unresolved(n, 'never'));
    const searches = [vi.spyOn(Buffer.prototype, 'indexOf'), vi.spyOn(Buffer.prototype, 'includes')]; // every byte search of a line
    try {
      expect(await paths({ bounds: { pending: n } }).names(S, P)).toBe(false);
      expect(searches.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBeLessThan(10 * n);
    } finally {
      for (const spy of searches) spy.mockRestore();
    }
  });

  it('at the cap: the 256 newest waiting results still resolve, the 257th-newest is not waited for', async () => {
    const resolved = result('toolu_resolved', `Saved to [r](${P})`);
    await writeTranscript([call('toolu_resolved', 'mcp__docs__save', {}), resolved, ...unresolved(NAMED_PENDING_MAX - 1, 'a')]);
    expect(await paths().names(S, P)).toBe(true);
    await writeTranscript([call('toolu_resolved', 'mcp__docs__save', {}), resolved, ...unresolved(NAMED_PENDING_MAX, 'b')]);
    expect(await paths().names(S, P)).toBe(false);
  });

  it('the cap is a bound the suite can set', async () => {
    await writeTranscript([call('toolu_resolved', 'mcp__docs__save', {}), result('toolu_resolved', `Saved to [r](${P})`), ...unresolved(3, 'c')]);
    expect(await paths({ bounds: { pending: 4 } }).names(S, P)).toBe(true);
    expect(await paths({ bounds: { pending: 3 } }).names(S, P)).toBe(false);
  });
});

// The search answers what the rule answers record by record, calls resolved, within the bound: generated transcripts,
// a seeded generator so a failure replays.
describe('the search and the rule agree', () => {
  function generator(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  it('over generated transcripts', async () => {
    const random = generator(20261113);
    const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]!;
    const other = '/work/out/report.md.bak';
    for (let round = 0; round < 120; round += 1) {
      const records: object[] = [];
      const ids: string[] = [];
      const count = 1 + Math.floor(random() * 24);
      for (let i = 0; i < count; i += 1) {
        const id = `toolu_${round}_${i}`;
        const roll = random();
        if (roll < 0.15) {
          ids.push(id);
          records.push(call(id, pick(['mcp__docs__save', 'Edit', 'Write', 'Bash', 'Read']), pick([{ file_path: '/work/out/x.md' }, { file_path: P }, { command: P }])));
        } else if (roll < 0.35 && ids.length > 0) {
          const target = random() < 0.85 ? pick(ids) : `toolu_none_${i}`;
          records.push(pick([result(target, `[r](${P})`), result(target, [text(`[r](${pick([P, other])})`)]), result(target, 'ok', { toolUseResult: { filePath: pick([P, other]) } }), result(target, P)]));
        } else if (roll < 0.45) {
          records.push(pick([linkTo(pick([P, other])), assistant(text(`see ${P}`)), user(`[r](${P})`, { isMeta: true }), user(`open [r](${pick([P, other])})`)]));
        } else if (roll < 0.55) {
          records.push(pick([{ type: 'api-request', messages: [{ content: `[r](${P})` }] }, { type: 'queue-operation', content: `[r](${P})` }, { type: 'summary', summary: `[r](${P})` }]));
        } else {
          records.push(...filler(1, Math.floor(random() * 300)));
        }
      }
      // what the rule says, record by record: a record that names, or a result whose nearest older call has the class it waits for
      const scan = random() < 0.3 ? Math.floor(bytesOf(records) * random()) : NAMED_SCAN_BYTES;
      const size = bytesOf(records);
      let offset = 0;
      const within = records.map((record) => {
        const start = offset;
        offset += Buffer.byteLength(lineOf(record)) + 1;
        return start >= size - scan;
      });
      const expected = records.some((record, index) => {
        if (!within[index]) return false;
        const claim = rowClaim(record, P);
        if (claim.names) return true;
        return claim.pending.some(({ toolUseId, when }) => {
          for (let earlier = index - 1; earlier >= 0 && within[earlier]; earlier -= 1) {
            const found = callClass(records[earlier], toolUseId);
            if (found !== null) return found === when;
          }
          return false;
        });
      });
      await writeTranscript(records);
      const chunk = 64 + Math.floor(random() * 2048);
      expect(await paths({ bounds: { chunk, scan } }).names(S, P), `round ${round}, chunk ${chunk}, scan ${scan}: ${records.map(lineOf).join('\n')}`).toBe(expected);
    }
  });
});

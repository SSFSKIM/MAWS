// The search for a file the transcript names, its memory and its queue (UX wave U6c,
// docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §B and the sequences S4 to S15). Every
// transcript here is made of invented records, written into a scratch store.
import { execFileSync } from 'node:child_process';
import { closeSync, constants, openSync, readdirSync, readFileSync } from 'node:fs';
import { cp, open as fsOpen, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile, mkdir, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { readArrivals } from '@shared/engine/arrival';
import { callClass, rowClaim } from '@shared/files/named';
import { SubagentReader } from '../../engine-host/fs/subagents';
import { loadUxwaveTranscript, TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { StoreFixture } from '../../../test/support/store-fixture';
import { OPENS_CONFIRMED, WALKED } from '../fs/no-link';
import { createNamedPaths, NAMED_AGENT_DIRS_MAX, NAMED_CHUNK_BYTES, NAMED_FINGERPRINT_BYTES, NAMED_ROW_BYTES, NAMED_SCAN_BYTES, NAMED_WAIT_MS, NAMED_WAITING_MAX, NAMED_CACHE_ENTRIES, NAMED_PENDING_MAX, NAMED_CLAIM_STEPS, NAMED_PATH_MAX, type Naming, type NamedPathsOptions } from './named';

// UX wave U6b-4c (M3): the directories read (`readdir`, which the search over a subagent's transcript walks by), counted
const dirReads = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: ((...args: Parameters<typeof actual.readdir>) => ((dirReads.count += 1), actual.readdir(...args))) as typeof actual.readdir };
});

const S = 'app-named' as AppSessionId;
const P = '/work/out/report.md';
const FP = NAMED_FINGERPRINT_BYTES;

// Records in the shapes the engine writes (test/fixtures/transcripts/), invented.
let serial = 0;
const text = (value: string) => ({ type: 'text', text: value });
const assistant = (...content: object[]) => ({ type: 'assistant', uuid: `a-${++serial}`, message: { role: 'assistant', content } });
const call = (id: string, name: string, input: object) => assistant({ type: 'tool_use', id, name, input });
// The person's origin, as the engine writes it on a typed prompt (Decision Log 22: only such a row counts as the person's)
const user = (content: string | object[], extra: object = {}) => ({ type: 'user', uuid: `u-${++serial}`, origin: { kind: 'human' }, message: { role: 'user', content }, ...extra });
const result = (id: string, content: string | object[], extra: object = {}) => user([{ type: 'tool_result', tool_use_id: id, content }], extra);
const filler = (n: number, size = 200) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? user(`note ${i} ${'x'.repeat(size)}`) : assistant(text(`reply ${i} ${'y'.repeat(size)}`))));
const linkTo = (path: string) => assistant(text(`Wrote [the report](${path}).`));
const lineOf = (record: object) => JSON.stringify(record);
// A row the probes recorded (spikes/protocol-probe/fixtures/uxwave/), its marks as recorded and one run of its words replaced
const recordedRow = (name: string, line: number, words: string, by: string): object => {
  const json = JSON.stringify(loadUxwaveTranscript(name)[line - 1]);
  if (!json.includes(words)) throw new Error(`${name}:${line} does not hold ${words}`);
  return JSON.parse(json.replace(words, JSON.stringify(by).slice(1, -1))) as object;
};
// The bridge's recorded delivery of the person's words, as a peer's: its frame names a session (U3a's reader, arrival.ts)
const peerByBridge = (by: string): object =>
  JSON.parse(JSON.stringify(recordedRow('u3-sminos-r1-terminal', 37, 'UXW owner idle: reply with only the word ONE.', by)).replace('from human id=5aa95008', 'from session:7ef6ac00 id=5aa95008')) as object;
const bytesOf = (records: object[]) => records.reduce((sum, record) => sum + Buffer.byteLength(lineOf(record)) + 1, 0);

let fixture: StoreFixture;
let file: string | null;
type HoldPoint = 'opened' | 'searched' | 'found' | 'walked';
let holds: Partial<Record<HoldPoint, () => Promise<void>>>;
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
const reset = () => (Object.assign(stats, { opens: 0, reads: 0, bytes: 0 }), (dirReads.count = 0));

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
function holdAt(point: HoldPoint, during?: () => Promise<void>) {
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
// each read noting `onRead` first: the loop then turns only where the search gives it back (fix round 1, item 4). U6b-4c:
// over the descriptor of a real open with the flags asked, which a subagent's open confirms on Linux.
function instant(onRead: () => void = () => {}): NonNullable<NamedPathsOptions['open']> {
  return async (path, flags) => {
    const opened = await fsOpen(path, flags);
    const bytes = await readFile(path);
    const status = await stat(path, { bigint: true });
    return {
      fd: opened.fd,
      stat: async () => status,
      read: (buffer: Buffer, offset: number, length: number, position: number) => {
        onRead();
        const n = Math.max(0, Math.min(length, bytes.length - position));
        bytes.copy(buffer, offset, position, position + n);
        return Promise.resolve({ bytesRead: n, buffer });
      },
      close: () => opened.close(),
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
    expect({ NAMED_SCAN_BYTES, NAMED_CHUNK_BYTES, NAMED_ROW_BYTES, NAMED_CACHE_ENTRIES, NAMED_WAITING_MAX, NAMED_WAIT_MS, NAMED_FINGERPRINT_BYTES, NAMED_PENDING_MAX, NAMED_CLAIM_STEPS, NAMED_PATH_MAX, NAMED_AGENT_DIRS_MAX }).toEqual({
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
      NAMED_AGENT_DIRS_MAX: 4096,
    });
  });
});

describe('names: what the transcript names', () => {
  it('a link in the newest rows names the path; one nowhere names nothing', async () => {
    await writeTranscript([...filler(10), linkTo(P), ...filler(2)]);
    const named = paths();
    expect(await named.names(S, P)).toBe('counted');
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
    ];
    for (const records of cases) {
      await writeTranscript([...filler(4), ...records, ...filler(4)]);
      expect(await paths().names(S, P), JSON.stringify(records)).toBe('counted');
    }
  });

  // UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, decision 22): what a tool returned
  // names the path for a read and never for a save; the search says which kind it found
  it('a result form names the path as a result: an MCP call’s text, and an edit’s filePath where it differs from the call’s input', async () => {
    const cases: object[][] = [
      [call('t1', 'mcp__docs__save', { title: 'r' }), ...filler(3), result('t1', `Saved to [r](${P})`)],
      [call('t1', 'Write', { file_path: '/work/out/elsewhere.md', content: 'x' }), ...filler(3), result('t1', 'File created', { toolUseResult: { type: 'create', filePath: P } })],
    ];
    for (const records of cases) {
      await writeTranscript([...filler(4), ...records, ...filler(4)]);
      expect(await paths().names(S, P), JSON.stringify(records)).toBe('result');
    }
  });

  it('an edit’s result names its file as the call’s input does: counted', async () => {
    await writeTranscript([...filler(4), call('t1', 'Write', { file_path: P, content: 'x' }), result('t1', 'File created', { toolUseResult: { type: 'create', filePath: P } }), ...filler(4)]);
    expect(await paths().names(S, P)).toBe('counted');
  });

  it('a result form in the newest rows does not stop the search: an older counted form makes the answer counted', async () => {
    await writeTranscript([...filler(20), linkTo(P), ...filler(20), call('t1', 'mcp__docs__save', {}), result('t1', `Saved to [r](${P})`), ...filler(3)]);
    expect(await paths({ bounds: { chunk: 1024 } }).names(S, P)).toBe('counted');
    await writeTranscript([...filler(20), user(`Open [r](${P})`, { origin: { kind: 'human' } }), ...filler(20), call('t1', 'mcp__docs__save', {}), result('t1', `Saved to [r](${P})`)]);
    expect(await paths({ bounds: { chunk: 1024 } }).names(S, P)).toBe('counted');
  });

  it('a path only a result names is searched to the bound and answered as a result', async () => {
    const records = [...filler(200), call('t1', 'mcp__docs__save', {}), result('t1', `Saved to [r](${P})`), ...filler(10)];
    await writeTranscript(records);
    expect(await paths({ bounds: { chunk: 4096 } }).names(S, P)).toBe('result');
    expect(stats.bytes).toBeGreaterThanOrEqual(bytesOf(records)); // the whole window: no counted form is older
  });

  // Decision Log 8: a `user` row someone other than the person wrote is a result form already resolved
  it('a link in a peer session’s message or a notification names the path as a result; the person’s own message counts', async () => {
    const peer = peerByBridge(`Open [r](${P})`);
    const notification = recordedRow('u3-tasks-r1', 38, 'Background command \\"uxw ok\\" completed (exit code 0)', `Wrote [r](${P})`);
    expect([peer, notification].map((row) => readArrivals(row).map((arrival) => arrival.class))).toEqual([['peer'], ['task']]);
    for (const row of [peer, notification]) {
      await writeTranscript([...filler(4), row, ...filler(4)]);
      expect(await paths().names(S, P), JSON.stringify(row)).toBe('result');
    }
    await writeTranscript([...filler(4), user(`Open [r](${P})`, { origin: { kind: 'human' } }), ...filler(4), peer, notification]);
    expect(await paths().names(S, P)).toBe('counted');
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
    expect(await named.names(S, outer)).toBe('counted');
  });

  // UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, N1.11): the window draws as many cells of a
  // row as the table's head has; a path linked only in a cell past them is not named
  it('a path linked only in a table cell past the head’s width is not named; in a cell the head covers it is', async () => {
    await writeTranscript([...filler(4), assistant(text(`| a | b |\n|---|---|\n| x | y | [r](${P}) |`)), ...filler(4)]);
    expect(await paths().names(S, P)).toBe(false);
    await writeTranscript([...filler(4), assistant(text(`| a | b |\n|---|---|\n| x | [r](${P}) | y |`)), ...filler(4)]);
    expect(await paths().names(S, P)).toBe('counted');
    await writeTranscript([...filler(4), assistant(text(`| a | b |\n|---|---|\n| x | y | [r](file://${P}) |`)), ...filler(4)]);
    expect(await paths().names(S, P)).toBe(false);
  });

  // UX wave U6b-4b (R1, N1.7): an inline `file:` link with an empty host names its path as the scheme-less link does; a
  // transcript whose only mention of the path is another `file:` form names nothing
  it('a `file:` link with an empty host names the path; one with a host, without `//`, as an autolink or a reference does not', async () => {
    const others = [`[r](file://host${P})`, `[r](file://localhost${P})`, `[r](file:${P})`, `<file://${P}>`, `[r][l]\n\n[l]: file://${P}`];
    await writeTranscript([...filler(4), ...others.map((form) => assistant(text(form))), ...filler(4)]);
    expect(await paths().names(S, P)).toBe(false);
    await writeTranscript([...filler(4), ...others.map((form) => assistant(text(form))), assistant(text(`Wrote [the report](file://${P}).`)), ...filler(4)]);
    expect(await paths().names(S, P)).toBe('counted');
    await writeTranscript([...filler(4), call('t1', 'mcp__docs__save', {}), result('t1', `Saved to [r](FILE://${P})`), ...filler(4)]);
    expect(await paths().names(S, P)).toBe('result');
  });

  // UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, L14): a subagent's own transcript adds no
  // evidence; the search reads the session's transcript alone
  it('a path written only in a subagent’s transcript file is not named; written in the session’s own, it is', async () => {
    await writeTranscript([...filler(4), assistant(text('Started a subagent.')), ...filler(4)]);
    const subagent = join(dirname(file!), 'engine-session-1', 'subagents', 'agent-a1.jsonl');
    await mkdir(dirname(subagent), { recursive: true });
    await writeFile(subagent, [...filler(2), linkTo(P), ...filler(2)].map((record) => `${lineOf(record)}\n`).join(''));
    expect(await paths().names(S, P)).toBe(false);
    await append([linkTo(P)]); // the control: the session's own transcript writes the same link
    expect(await paths().names(S, P)).toBe('counted');
  });

  it('a hit before a compaction boundary still names the path', async () => {
    await writeTranscript([linkTo(P), ...filler(4), { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }, user('Summary of the conversation so far', { isCompactSummary: true }), ...filler(4)]);
    expect(await paths().names(S, P)).toBe('counted');
  });

  it('a name with a quote, a backslash, a space and non-ASCII letters is found', async () => {
    const odd = '/work/out/say "hi" \\x 보고서.md';
    await writeTranscript([...filler(4), assistant(text(`See [it](<${odd}>).`)), ...filler(4)]);
    expect(await paths().names(S, odd)).toBe('counted');
  });

  it('a record older than the bound is not named; one wholly inside it is', async () => {
    const records = [linkTo(P), ...filler(20)];
    await writeTranscript(records);
    const after = bytesOf(records.slice(1));
    expect(await paths({ bounds: { scan: after } }).names(S, P)).toBe(false);
    expect(await paths({ bounds: { scan: after + Buffer.byteLength(lineOf(records[0]!)) + 1 } }).names(S, P)).toBe('counted');
  });

  it('a line longer than the row bound is passed over', async () => {
    const long = assistant(text(`[r](${P}) ${'z'.repeat(9_000)}`));
    await writeTranscript([...filler(2), long, ...filler(2)]);
    expect(await paths({ bounds: { row: 8_000, chunk: 1_000 } }).names(S, P)).toBe(false);
    expect(await paths({ bounds: { row: 10_000, chunk: 1_000 } }).names(S, P)).toBe('counted');
  });

  it('a last line with no end is not read, and is searched once it is whole', async () => {
    await writeTranscript(filler(4));
    await fixture.appendBytes(file!, Buffer.from(lineOf(linkTo(P))));
    const named = paths();
    expect(await named.names(S, P)).toBe(false);
    await fixture.appendBytes(file!, Buffer.from('\n'));
    expect(await named.names(S, P)).toBe('counted');
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
      expect(await named.names(S, P)).toBe('counted');
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
    expect(await paths({ bounds: { chunk: 4096 } }).names(S, P)).toBe('counted');
    expect(bytesOf(records)).toBeGreaterThan(50_000);
    expect(stats.bytes).toBeLessThan(5 * 4096); // a chunk, two fingerprints' worth at most, and the proof
  });

  it('after a hit, a later ask reads the naming record’s bytes again and no more', async () => {
    const naming = linkTo(P);
    await writeTranscript([...filler(50), naming, ...filler(5)]);
    const named = paths();
    expect(await named.names(S, P)).toBe('counted');
    reset();
    expect(await named.names(S, P)).toBe('counted');
    expect(stats.bytes).toBe(Buffer.byteLength(lineOf(naming)) + 2); // the line, the byte before and the byte after
  });

  // U6e (S14): a result-only answer is remembered as that record's place, with a miss's checkpoint beside it
  it('after a result-only answer, a later ask reads the two records again and what was written since, and no more', async () => {
    const records = [call('t1', 'mcp__docs__save', { title: 'r' }), ...filler(10), result('t1', `Saved to [r](${P})`), ...filler(3)];
    await writeTranscript([...filler(300), ...records]);
    const named = paths({ bounds: { chunk: 4096 } });
    expect(await named.names(S, P)).toBe('result');
    reset();
    expect(await named.names(S, P)).toBe('result');
    const proof = Buffer.byteLength(lineOf(records[11]!)) + 2 + Buffer.byteLength(lineOf(records[0]!)) + 2;
    expect(stats.bytes).toBe(proof + 2 * FP); // the record and its call, and the checkpoint's fingerprint proven again
    const added = [...filler(5), result('t1', `Saved to [r](${P})`), ...filler(5)];
    await append(added);
    reset();
    expect(await named.names(S, P)).toBe('result');
    expect(stats.bytes).toBeLessThanOrEqual(proof + bytesOf(added) + 3 * 2 * FP + 2 * 4096);
  });

  it('after a result-only answer, a counted form written since makes the answer counted, and a record that no longer names drops the memory (S14)', async () => {
    const records = [...filler(50), call('t1', 'mcp__docs__save', {}), result('t1', `Saved to [r](${P})`), ...filler(3)];
    await writeTranscript(records);
    const named = paths();
    expect(await named.names(S, P)).toBe('result');
    await append([linkTo(P)]);
    expect(await named.names(S, P)).toBe('counted');
    await writeTranscript(records);
    const fresh = paths();
    expect(await fresh.names(S, P)).toBe('result');
    const unnamed = { ...result('t1', `Saved to [r](/work/out/rePort.md)`), uuid: (records[51] as { uuid: string }).uuid };
    await rewriteInPlace([...records.slice(0, 51), unnamed, ...records.slice(52)]);
    reset();
    expect(await fresh.names(S, P)).toBe(false);
    expect(stats.bytes).toBeGreaterThan(bytesOf(filler(50))); // the memory dropped: the whole window again
  });

  it('after a miss, only what was written since is searched', async () => {
    await writeTranscript(filler(500));
    const before = (await stat(file!)).size;
    const named = paths({ bounds: { chunk: 4096 } });
    expect(await named.names(S, P)).toBe(false);
    const added = [...filler(5), linkTo(P), ...filler(5)];
    await append(added);
    reset();
    expect(await named.names(S, P)).toBe('counted');
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
    expect(await named.names(S, P)).toBe('counted');
    expect(await named.names(S, other)).toBe('counted');
    reset();
    expect(await named.names(S, P)).toBe('counted');
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
    expect(await named.names(S, P)).toBe('counted');
  });

  it('S4: growth seen only after the search does not change its answer', async () => {
    await writeTranscript(filler(20));
    const named = paths();
    const held = holdAt('searched', () => append([linkTo(P)]));
    const asked = named.names(S, P);
    await held.reached;
    held.release();
    expect(await asked).toBe(false);
    expect(await named.names(S, P)).toBe('counted');
  });

  it('S5: a transcript renamed into another folder between two asks: the hit is proven at the new place and stands', async () => {
    const naming = linkTo(P);
    await writeTranscript([...filler(20), naming, ...filler(2)]);
    const named = paths();
    expect(await named.names(S, P)).toBe('counted');
    const moved = join(fixture.configHome, 'projects', 'another-folder', 'engine-session-1.jsonl');
    await mkdir(dirname(moved), { recursive: true });
    await rename(file!, moved);
    file = moved;
    reset();
    expect(await named.names(S, P)).toBe('counted');
    expect(stats.bytes).toBe(Buffer.byteLength(lineOf(naming)) + 2);
  });

  it('S6: a transcript at neither place for a moment: not named, nothing thrown, and found again once it is back', async () => {
    const path = await writeTranscript([linkTo(P)]);
    const named = paths();
    file = `${path}.moving`;
    expect(await named.names(S, P)).toBe(false);
    file = path;
    expect(await named.names(S, P)).toBe('counted');
  });

  it('S7: two asks for one session and path at once share one job', async () => {
    await writeTranscript([...filler(20), linkTo(P)]);
    const locate = vi.fn(async () => file);
    const named = paths({ transcript: locate });
    expect(await Promise.all([named.names(S, P), named.names(S, P)])).toEqual(['counted', 'counted']);
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
    expect(await before).toBe('counted'); // asked while the session was bound to the old transcript
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
    expect(await named.names(S, P)).toBe('counted');
    expect(stats.bytes).toBeGreaterThan(bytesOf(filler(100))); // the whole transcript searched again
  });

  it('S9: rewritten in place to the same length without the naming record: proven, dropped, searched again, not named', async () => {
    const records = [...filler(10), linkTo(P), ...filler(10)];
    await writeTranscript(records);
    const named = paths();
    expect(await named.names(S, P)).toBe('counted');
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
    expect(await named.names(S, P)).toBe('counted');
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
    expect(await named.names(S, P)).toBe('counted');
  });

  it('S12: after a miss, a rewrite that puts the link before the checkpoint fails the fingerprint, and the whole window is searched', async () => {
    const records = [...filler(3), linkTo('/work/out/rePort.md'), ...filler(3)];
    await writeTranscript(records);
    const named = paths();
    expect(await named.names(S, P)).toBe(false);
    await rewriteInPlace([...records.slice(0, 3), { ...linkTo(P), uuid: (records[3] as { uuid: string }).uuid }, ...records.slice(4)]);
    expect(await named.names(S, P)).toBe('counted');
  });

  it('S13: a result added since a miss, whose call is older than the checkpoint, is named once its call is found', async () => {
    await writeTranscript([call('t1', 'mcp__docs__save', { title: 'r' }), call('t2', 'Edit', { file_path: '/work/out/x.md', old_string: 'a', new_string: 'b' }), ...filler(30)]);
    const named = paths({ bounds: { chunk: 1024 } });
    expect(await named.names(S, P)).toBe(false);
    expect(await named.names(S, '/work/out/edited.md')).toBe(false);
    await append([result('t1', `Saved to [r](${P})`), result('t2', 'ok', { toolUseResult: { filePath: '/work/out/edited.md' } })]);
    expect(await named.names(S, P)).toBe('result');
    expect(await named.names(S, '/work/out/edited.md')).toBe('result');
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
    expect(await running).toBe('counted');
    expect(await Promise.all(waiting)).toEqual(others.map(() => 'counted'));
    expect(await sameAsWaiting).toBe('counted');
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
    expect(await named.names(S, P)).toBe('counted');
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
    expect(await named.names(S, P)).toBe('counted');
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
    expect(await first).toBe('counted');
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
      expect(await paths({ open: instant(() => at.push(loop.ticks())), bounds: { chunk: 2048 } }).names(S, P)).toBe('counted');
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
    expect(await paths().names(S, under)).toBe('counted'); // under the bound, a long path is read as any
  });

  // fix round 1, item 3: a request's patience and its signal run from the moment it is made, the locator's wait
  // included; the queue has only what is left; a locator that answers after the request ended queues nothing
  it('a held locator: the request answers not named on time, or at once when its signal ends, and queues nothing', async () => {
    await writeTranscript([linkTo(P)]);
    const located = deferred();
    const named = paths({ transcript: () => located.promise.then(() => file), bounds: { waitMs: 20 } });
    const late = Symbol('still pending');
    const within = (answer: Promise<Naming>, ms: number) => Promise.race([answer, new Promise<typeof late>((done) => setTimeout(() => done(late), ms))]);
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
    async function searched(row: object): Promise<Naming> {
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
      expect(await searched(assistant(text(`[r](${P}) ${`[r](${P}.bak) `.repeat(candidates)}`)))).toBe('counted');
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
    expect(await paths().names(S, P)).toBe('result');
    await writeTranscript([call('toolu_resolved', 'mcp__docs__save', {}), resolved, ...unresolved(NAMED_PENDING_MAX, 'b')]);
    expect(await paths().names(S, P)).toBe(false);
  });

  it('the cap is a bound the suite can set', async () => {
    await writeTranscript([call('toolu_resolved', 'mcp__docs__save', {}), result('toolu_resolved', `Saved to [r](${P})`), ...unresolved(3, 'c')]);
    expect(await paths({ bounds: { pending: 4 } }).names(S, P)).toBe('result');
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
          records.push(pick([linkTo(pick([P, other])), assistant(text(`see ${P}`)), user(`[r](${P})`, { isMeta: true }), user(`open [r](${pick([P, other])})`), user(`<task-notification>\n<summary>[r](${P})</summary>\n</task-notification>`, { origin: { kind: 'task-notification' } })]));
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
      // U6e: counted when a record names it by a counted form, else a result when one names it by a result form
      const claims = records.map((record, index) => (within[index] ? rowClaim(record, P) : null));
      const resolved = records.some((_, index) => {
        const claim = claims[index];
        if (!claim || claim.names) return false;
        if (claim.other) return true;
        return claim.pending.some(({ toolUseId, when }) => {
          for (let earlier = index - 1; earlier >= 0 && within[earlier]; earlier -= 1) {
            const found = callClass(records[earlier], toolUseId);
            if (found !== null) return found === when;
          }
          return false;
        });
      });
      const expected = claims.some((claim) => claim?.names === true) ? 'counted' : resolved ? 'result' : false;
      await writeTranscript(records);
      const chunk = 64 + Math.floor(random() * 2048);
      expect(await paths({ bounds: { chunk, scan } }).names(S, P), `round ${round}, chunk ${chunk}, scan ${scan}: ${records.map(lineOf).join('\n')}`).toBe(expected);
    }
  });
});

// UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, M3; Interfaces §E, R2 and R4): the
// search over one subagent's transcript, which a follow names by the agent's id. The file is found under the session's
// own transcript folder by reading directories alone, opened with no link on its way, and read by the subagent's rule.
describe('namesInAgent: what one subagent’s transcript names', () => {
  const AGENT = 'a1b2c3';
  const THEIRS = 'app-theirs' as AppSessionId;
  const folderOf = (transcript: string) => transcript.slice(0, -'.jsonl'.length);
  // The conversation a transcript is of (its engine session, the file's name), and the subagent a follow names in it
  const conversationOf = (transcript: string) => basename(transcript, '.jsonl');
  const agent = (id = AGENT, transcript: string | null = file) => ({ id, engineSessionId: transcript === null ? 'engine-session-none' : conversationOf(transcript) });
  const agentFile = (agentId: string, dirs: string[] = [], transcript = file!) => join(folderOf(transcript), 'subagents', ...dirs, `agent-${agentId}.jsonl`);
  // Every record as the engine writes a subagent's: its conversation's id and the agent's own (a record's own keys win)
  async function writeAgent(agentId: string, records: object[], dirs: string[] = [], transcript = file!): Promise<string> {
    const path = agentFile(agentId, dirs, transcript);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, records.map((record) => `${lineOf({ sessionId: conversationOf(transcript), agentId, ...record })}\n`).join(''));
    return path;
  }
  // A subagent's records as the engine writes them (test/fixtures/transcripts/…/subagents/): every one a sidechain and none
  // with an origin; its first `user` record is the prompt its parent wrote
  const sidechain = (record: object) => ({ ...record, isSidechain: true });
  const prompt = (content: string) => sidechain({ type: 'user', uuid: `u-${++serial}`, message: { role: 'user', content } });
  const returned = (id: string, content: string) => sidechain({ type: 'user', uuid: `u-${++serial}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
  const linking = () => [prompt('Look into the report.'), sidechain(linkTo(P))];
  // Replace `path` by a link to `target`, keeping it beside under another name.
  async function swapForLink(path: string, target: string) {
    await rename(path, `${path}.away`);
    await symlink(target, path);
  }
  // Another session's transcript and its folder, and a search that knows both sessions
  async function theirs(): Promise<string> {
    return fixture.addTranscript('/work/theirs', 'engine-session-9', filler(2).map(lineOf));
  }
  const both = (their: string, extra: Partial<NamedPathsOptions> = {}) => paths({ transcript: async (appSessionId) => (appSessionId === THEIRS ? their : file), ...extra });

  it('counts a link in the subagent’s own text and its calls’ chips, which `names` does not name; neither answer is the other’s memory (R6)', async () => {
    await writeTranscript([...filler(4), assistant(text('Started a subagent.')), ...filler(2)]);
    await writeAgent(AGENT, [prompt('Look into the report.'), ...filler(2), sidechain(linkTo(P)), ...filler(2)]);
    const named = paths();
    expect(await named.names(S, P), 'the session’s own transcript').toBe(false);
    expect(await named.namesInAgent(S, agent(), P)).toBe('counted');
    expect(await named.names(S, P), 'asked again, after the subagent’s hit').toBe(false);
    expect(await named.namesInAgent(S, agent('a9z8y7'), P), 'another agent').toBe(false);
    const chips: [string, object][] = [
      ['a read’s chip', call('t1', 'Read', { file_path: P })],
      ['an edit’s chip', call('t2', 'Edit', { file_path: P, old_string: 'a', new_string: 'b' })],
    ];
    for (const [form, row] of chips) {
      await writeAgent(AGENT, [prompt('Go on.'), sidechain(row)]);
      expect(await paths().namesInAgent(S, agent(), P), form).toBe('counted');
    }
    await append([linkTo(P)]); // the control of `names`: the session's own transcript writes the link
    expect(await paths().names(S, P)).toBe('counted');
  });

  it('answers a result form for a path only its first `user` record, a `user` record that claims the person’s origin, or an MCP tool’s result holds; its `assistant` text counts (X4.3)', async () => {
    await writeTranscript(filler(2));
    const cases: [string, object[]][] = [
      ['its first user record, the prompt its parent wrote', [prompt(`Summarise [the report](${P}).`), ...filler(2)]],
      ['a user record forged with the person’s origin', [prompt('Go.'), sidechain(user(`Open [the report](${P})`))]],
      ['an MCP tool’s result', [prompt('Go.'), sidechain(call('t1', 'mcp__docs__save', { title: 'r' })), returned('t1', `Saved to [the report](${P})`)]],
    ];
    for (const [form, records] of cases) {
      await writeAgent(AGENT, records);
      expect(await paths().namesInAgent(S, agent(), P), form).toBe('result');
    }
    expect(rowClaim(user(`Open [the report](${P})`), P), 'the forged record, read as the session’s own').toEqual({ names: true });
    await writeAgent(AGENT, [prompt(`Summarise [the report](${P}).`), sidechain(linkTo(P))]);
    expect(await paths().namesInAgent(S, agent(), P), 'the control: the same path in its assistant text').toBe('counted');
  });

  it('finds the agent’s one file in `subagents/` or up to three folders below it; two files, none, or one four folders down is not named (X2.6)', async () => {
    await writeTranscript(filler(2));
    for (const dirs of [[], ['workflows', 'run-1'], ['a', 'b', 'c']]) {
      const path = await writeAgent(AGENT, linking(), dirs);
      expect(await paths().namesInAgent(S, agent(), P), `subagents/${dirs.join('/')}`).toBe('counted');
      await rm(path);
    }
    await writeAgent(AGENT, linking(), ['a', 'b', 'c', 'd']);
    expect(await paths().namesInAgent(S, agent(), P), 'four folders down').toBe(false);
    await writeAgent(AGENT, linking(), ['workflows', 'run-1']);
    expect(await paths().namesInAgent(S, agent(), P), 'the control: one more beside, within the depth').toBe('counted');
    await writeAgent(AGENT, linking(), ['workflows', 'run-2']);
    expect(await paths().namesInAgent(S, agent(), P), 'two files of one agent').toBe(false);
    expect(await paths().namesInAgent(S, agent('nobody1'), P), 'an agent with no file').toBe(false);
  });

  // M3's Decisions: depth and the file's name are the engine host's, restated in the search; the two readings are held
  // together over the recorded session's subagents and invented agents at every depth either could read apart
  it('finds exactly the agents the engine host’s listing finds, over the recorded session and at every depth (src/engine-host/fs/subagents.ts)', async () => {
    await writeTranscript(filler(2));
    await cp(join(TEST_FIXTURE_DIR, 'transcripts', '9a1d4262-0b43-46ad-acb9-5982f31d209c', 'subagents'), join(folderOf(file!), 'subagents'), { recursive: true });
    const placed: [string, string[]][] = [['d0', []], ['d1', ['workflows']], ['d2', ['workflows', 'run-1']], ['d3', ['a', 'b', 'c']], ['d4', ['a', 'b', 'c', 'd']], ['d5', ['workflows', 'run-1', 'x', 'y']]];
    for (const [agentId, dirs] of placed) await writeAgent(agentId, [prompt('Go.')], dirs);
    // every agent file there, at any depth, gains a record that links a path of its own
    const ids: string[] = [];
    const mark = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const id = /^agent-(.+)\.jsonl$/.exec(entry.name)?.[1];
        if (entry.isDirectory()) await mark(join(dir, entry.name));
        else if (id !== undefined && entry.isFile()) {
          ids.push(id);
          await writeFile(join(dir, entry.name), `${lineOf({ sessionId: conversationOf(file!), agentId: id, ...sidechain(linkTo(`/work/out/${id}.md`)) })}\n`, { flag: 'a' });
        }
      }
    };
    await mark(join(folderOf(file!), 'subagents'));
    expect(ids, 'the recorded agents are among them').toEqual(expect.arrayContaining(['ad286defbc77bc090', 'ae75ba6ce5d866acc', 'd4', 'd5']));
    const listed = (await new SubagentReader().list(folderOf(file!))).map((agent) => agent.agentId as string);
    const named = paths();
    const found: string[] = [];
    for (const id of ids) if ((await named.namesInAgent(S, agent(id), `/work/out/${id}.md`)) === 'counted') found.push(id);
    expect(found.sort()).toEqual(listed.sort());
    expect(listed.sort()).toEqual(['ad286defbc77bc090', 'ae75ba6ce5d866acc', 'd0', 'd1', 'd2', 'd3']);
  });

  it('reads no subagent’s file reached through a link: the session’s folder, `subagents`, a folder under it, or the file itself; nor one whose folder became a link after the walk found it (X2.9)', async () => {
    const their = await theirs();
    await writeAgent(AGENT, linking(), ['workflows', 'run-1'], their);
    expect(await both(their).namesInAgent(THEIRS, agent(AGENT, their), P), 'the control: their file, under their session').toBe('counted');
    const mine = await writeTranscript(filler(2));
    const subagents = join(folderOf(mine), 'subagents');
    await symlink(folderOf(their), folderOf(mine));
    expect(await both(their).namesInAgent(S, agent(), P), 'the session’s folder a link').toBe(false);
    await unlink(folderOf(mine));
    await mkdir(folderOf(mine));
    await symlink(join(folderOf(their), 'subagents'), subagents);
    expect(await both(their).namesInAgent(S, agent(), P), '`subagents` a link').toBe(false);
    await unlink(subagents);
    await mkdir(subagents);
    await symlink(join(folderOf(their), 'subagents', 'workflows'), join(subagents, 'workflows'));
    expect(await both(their).namesInAgent(S, agent(), P), 'a folder under `subagents` a link').toBe(false);
    await unlink(join(subagents, 'workflows'));
    await mkdir(join(subagents, 'workflows', 'run-1'), { recursive: true });
    await symlink(agentFile(AGENT, ['workflows', 'run-1'], their), agentFile(AGENT, ['workflows', 'run-1']));
    expect(await both(their).namesInAgent(S, agent(), P), 'the file a link').toBe(false);
    await unlink(agentFile(AGENT, ['workflows', 'run-1']));
    await writeAgent(AGENT, linking(), ['workflows', 'run-1']);
    expect(await both(their).namesInAgent(S, agent(), P), 'the control: the same file, reached with no link').toBe('counted');
    // the session's file no longer links the path, theirs does: a way through a link would read theirs
    await writeAgent(AGENT, [prompt('Go.')], ['workflows', 'run-1']);
    holds.found = () => swapForLink(join(subagents, 'workflows'), join(folderOf(their), 'subagents', 'workflows'));
    expect(await both(their).namesInAgent(S, agent(), P), 'a folder on its way swapped for a link after the walk').toBe(false);
    expect(holds.found, 'the walk found the file').toBeUndefined();
  });

  // The branch panel (scalpel-2, finding 1): the walk and the open hand on a path alone, so a regular file renamed into the
  // found file's place between them is what is opened; only records that this agent of this conversation wrote count
  it('counts only records that carry its conversation’s id and the agent’s: a file put in the found file’s place between the walk and the open names nothing (the branch panel)', async () => {
    const their = await theirs();
    await writeTranscript(filler(2));
    const found = await writeAgent(AGENT, [prompt('Go.')]);
    // an agent of the same id in another conversation, and another agent of this one, each linking the path
    const elsewhere = await writeAgent(AGENT, linking(), [], their);
    const sibling = await writeAgent('d9e8f7', linking());
    for (const [what, replacement] of [['another conversation’s agent of the same id', elsewhere], ['another agent of this conversation', sibling]] as const) {
      const copy = `${found}.next`;
      await cp(replacement, copy);
      holds.found = () => rename(copy, found);
      expect(await both(their).namesInAgent(S, agent(), P), what).toBe(false);
      expect(holds.found, `${what}: the walk found the file`).toBeUndefined();
    }
    await writeAgent(AGENT, [prompt('Go.'), { ...sidechain(linkTo(P)), agentId: undefined }]);
    expect(await paths().namesInAgent(S, agent(), P), 'a record with no agent’s id').toBe(false);
    await writeAgent(AGENT, linking());
    expect(await paths().namesInAgent(S, agent(), P), 'the control: its own records').toBe('counted');
  });

  // The branch panel (scalpel-2, finding 3): a follow from a drill-in still shown after `/clear` names the conversation it
  // was drawn for, which the session's transcript no longer is (Q11)
  it('names nothing for a conversation the session is no longer bound to, though the one it is bound to has the agent (Q11, the branch panel)', async () => {
    await writeTranscript(filler(2));
    await writeAgent(AGENT, linking());
    expect(await paths().namesInAgent(S, { id: AGENT, engineSessionId: 'engine-session-0' }, P), 'a conversation left behind').toBe(false);
    expect(await paths().namesInAgent(S, agent(), P), 'the control: the conversation it is bound to').toBe('counted');
  });

  // Where the open helper walks the folders first (Linux), a folder swapped between its walk and its open is followed by
  // the open, and refused by the descriptor's own path (`confirmOpened`)
  it.runIf(WALKED && OPENS_CONFIRMED)('refuses a folder swapped for a link between the open’s own walk and the open, by the descriptor’s own path (X2.9, Linux)', async () => {
    const their = await theirs();
    await writeAgent(AGENT, linking(), ['workflows', 'run-1'], their);
    await writeTranscript(filler(2));
    await writeAgent(AGENT, [prompt('Go.')], ['workflows', 'run-1']);
    holds.walked = () => swapForLink(join(folderOf(file!), 'subagents', 'workflows'), join(folderOf(their), 'subagents', 'workflows'));
    expect(await both(their).namesInAgent(S, agent(), P)).toBe(false);
    expect(holds.walked, 'the open walked').toBeUndefined();
    expect(await both(their).namesInAgent(THEIRS, agent(AGENT, their), P), 'the control: the file the link leads to names the path').toBe('counted');
  });

  it('finds an agent’s file only under its own session’s transcript folder, and reads nothing for a session with no transcript (X2.7, X2.8)', async () => {
    const their = await theirs();
    await writeAgent(AGENT, linking(), [], their);
    await writeTranscript(filler(2));
    await mkdir(join(folderOf(file!), 'subagents'), { recursive: true });
    expect(await both(their).namesInAgent(S, agent(), P), 'asked under this session').toBe(false);
    expect(await both(their).namesInAgent(THEIRS, agent(AGENT, their), P), 'the control: asked under its own').toBe('counted');
    reset();
    expect(await paths({ transcript: async () => null }).namesInAgent(S, agent(), P), 'no transcript').toBe(false);
    expect(await paths({ transcript: async () => `${folderOf(their)}.json` }).namesInAgent(THEIRS, agent(AGENT, their), P), 'a transcript not named `.jsonl`').toBe(false);
    expect({ dirs: dirReads.count, opens: stats.opens }).toEqual({ dirs: 0, opens: 0 });
  });

  // The branch's M3 review: a search whose last waiter left starts no further stage on the disk (W2 a, W3). Its client ends
  // after the walk found the file: nothing is opened, the slot is free, and the job waiting behind it runs.
  it('starts no further stage once its last waiter has left: an abort after the walk found the file opens nothing, and the next job runs', async () => {
    await writeTranscript([linkTo('/work/out/next.md')]);
    await writeAgent(AGENT, linking());
    for (const point of ['found', ...(WALKED ? ['walked' as const] : [])] as const) {
      const named = paths();
      const client = new AbortController();
      const held = holdAt(point, async () => client.abort());
      const abandoned = named.namesInAgent(S, agent(), P, client.signal);
      await held.reached;
      const next = named.names(S, '/work/out/next.md'); // waits behind it, in the one slot
      reset();
      held.release();
      expect(await abandoned, point).toBe(false);
      expect(await next, `${point}: the next job runs`).toBe('counted');
      expect(stats.opens, `${point}: only the next job's transcript is opened`).toBe(1);
    }
    expect(await paths().namesInAgent(S, agent(), P), 'the control: the same search, not abandoned').toBe('counted');
  });

  // The branch's M3 re-review: the client ends while the agent file's open is under way, and the open then succeeds: the
  // descriptor is closed with nothing asked of it (no stat), and the job waiting behind runs.
  it('closes, unread, an agent file whose open answered after its last waiter left, and the next job runs', async () => {
    await writeTranscript([linkTo('/work/out/next.md')]);
    const agentPath = await realpath(await writeAgent(AGENT, linking())); // as the search opens it: under the real path of the transcript's folder
    const client = new AbortController();
    const asked: string[] = [];
    const open: NonNullable<NamedPathsOptions['open']> = async (path, flags) => {
      const handle = await counting(path, flags);
      if (path !== agentPath) return handle;
      client.abort(); // while the open was pending: it answers after the last waiter left
      const stat = handle.stat.bind(handle);
      const close = handle.close.bind(handle);
      return Object.assign(handle, {
        stat: (...args: Parameters<FileHandle['stat']>) => (asked.push('stat'), stat(...args)),
        close: () => (asked.push('close'), close()),
      });
    };
    const named = paths({ open });
    const held = holdAt('found');
    const abandoned = named.namesInAgent(S, agent(), P, client.signal);
    await held.reached;
    const next = named.names(S, '/work/out/next.md'); // waits behind it, in the one slot
    held.release();
    expect(await abandoned).toBe(false);
    expect(await next, 'the next job runs').toBe('counted');
    expect(asked, 'closed, with no stat').toEqual(['close']);
    expect(await paths({ open }).namesInAgent(S, agent(), P), 'the control: the same open, its waiter still there').toBe('counted');
  });

  it('a request made after the session is bound to another transcript does not join the search of the old one’s subagent (X2.11, W3)', async () => {
    await writeTranscript(filler(2));
    await writeAgent(AGENT, linking());
    const rebound = await fixture.addTranscript('/work/repo', 'engine-session-2', filler(2).map(lineOf));
    const named = paths();
    const held = holdAt('opened');
    const before = named.namesInAgent(S, agent(), P);
    await held.reached;
    file = rebound; // `/clear`: the session's transcript is now another, whose folder holds no such agent
    const after = named.namesInAgent(S, agent(), P);
    held.release();
    expect(await before).toBe('counted');
    expect(await after).toBe(false);
    await writeAgent(AGENT, linking(), [], rebound);
    expect(await named.namesInAgent(S, agent(), P), 'the control: the new folder’s agent').toBe('counted');
  });

  it('finds one agent’s file among 4,000 by reading folders alone: one file opened (K13)', async () => {
    await writeTranscript(filler(2));
    const subagents = join(folderOf(file!), 'subagents');
    const run = join(subagents, 'workflows', 'run-1');
    await mkdir(run, { recursive: true });
    const other = `${lineOf(prompt('Go.'))}\n`;
    for (let i = 0; i < 4000; i += 200) await Promise.all(Array.from({ length: 200 }, (_, n) => writeFile(join((i + n) % 4 === 0 ? run : subagents, `agent-x${i + n}.jsonl`), other)));
    await writeAgent(AGENT, linking(), ['workflows', 'run-1']);
    reset();
    expect(await paths().namesInAgent(S, agent(), P)).toBe('counted');
    expect({ opens: stats.opens, dirs: dirReads.count }).toEqual({ opens: 1, dirs: 3 }); // subagents, workflows, run-1
  });

  it('reads at most its bound of folders to find the file; past it, not named', async () => {
    await writeTranscript(filler(2));
    for (const dir of ['a', 'b']) await mkdir(join(folderOf(file!), 'subagents', dir), { recursive: true });
    await writeAgent(AGENT, linking(), ['c']);
    expect(await paths({ bounds: { dirs: 4 } }).namesInAgent(S, agent(), P), 'subagents and its three folders').toBe('counted');
    expect(await paths({ bounds: { dirs: 3 } }).namesInAgent(S, agent(), P)).toBe(false);
  });

  it('gives the event loop back after every read of the subagent’s file, as the session’s search does (K13)', async () => {
    await writeTranscript(filler(2));
    await writeAgent(AGENT, [prompt('Go.'), sidechain(linkTo(P)), ...filler(400)]);
    const loop = ticker();
    const at: number[] = [];
    try {
      expect(await paths({ open: instant(() => at.push(loop.ticks())), bounds: { chunk: 2048 } }).namesInAgent(S, agent(), P)).toBe('counted');
    } finally {
      loop.stop();
    }
    expect(at.length).toBeGreaterThan(20);
    for (let i = 1; i < at.length; i += 1) expect(at[i], `read ${i}`).toBeGreaterThan(at[i - 1]!);
  });

  it('shares the one slot and the queue of eight: with eight jobs waiting, a burst of asks for the session is answered at once and reads no folder (K13)', async () => {
    const others = Array.from({ length: NAMED_WAITING_MAX }, (_, i) => `/work/out/waiting-${i}.md`);
    await writeTranscript([linkTo(P), ...others.map(linkTo)]);
    await writeAgent(AGENT, linking());
    const named = paths();
    const held = holdAt('opened');
    const running = named.names(S, P);
    await held.reached;
    const waiting = others.map((path) => named.names(S, path));
    await turns(2); // their transcript found, they wait
    reset();
    const located = vi.fn();
    const burst = await Promise.all(['/work/out/a.md', '/work/out/b.md', P].map((path) => named.namesInAgent(S, agent(), path, undefined, located)));
    expect(burst).toEqual([false, false, false]);
    expect({ dirs: dirReads.count, opens: stats.opens, located: located.mock.calls.length }).toEqual({ dirs: 0, opens: 0, located: 3 });
    held.release();
    expect(await running).toBe('counted');
    expect(await Promise.all(waiting)).toEqual(others.map(() => 'counted'));
    expect(await named.namesInAgent(S, agent(), P), 'the control, the queue free').toBe('counted');
  });

  // Interfaces §D, Decision Log 10: a follow keeps its place until its search's call of the transcript locator has
  // settled. `located` is called exactly once, then: when the locator answered, threw, or was never asked, and also
  // after the request itself was answered.
  describe('`located`: once, when the request’s call of the locator has settled', () => {
    it('after the locator answered, whatever the search then answers', async () => {
      await writeTranscript(filler(2));
      await writeAgent(AGENT, linking());
      for (const [path, answer] of [[P, 'counted'], ['/work/out/other.md', false]] as const) {
        const located = vi.fn();
        expect(await paths().namesInAgent(S, agent(), path, undefined, located)).toBe(answer);
        expect(located, String(answer)).toHaveBeenCalledTimes(1);
      }
    });

    it('after the request was answered first: its patience ran out, or its client ended, while the locator was held', async () => {
      await writeTranscript(filler(2));
      await writeAgent(AGENT, linking());
      const locator = deferred();
      const named = paths({ transcript: () => locator.promise.then(() => file), bounds: { waitMs: 20 } });
      const timedOut = vi.fn();
      const ended = vi.fn();
      expect(await named.namesInAgent(S, agent(), P, undefined, timedOut)).toBe(false);
      const client = new AbortController();
      const asked = named.namesInAgent(S, agent(), P, client.signal, ended);
      client.abort();
      expect(await asked).toBe(false);
      expect({ timedOut: timedOut.mock.calls.length, ended: ended.mock.calls.length }, 'answered, the locator still held').toEqual({ timedOut: 0, ended: 0 });
      reset();
      locator.resolve();
      await turns();
      expect({ timedOut: timedOut.mock.calls.length, ended: ended.mock.calls.length }).toEqual({ timedOut: 1, ended: 1 });
      expect({ dirs: dirReads.count, opens: stats.opens }, 'neither queued a search').toEqual({ dirs: 0, opens: 0 });
    });

    it('when the locator rejects, or throws as it is called: not named, and nothing thrown', async () => {
      await writeTranscript(filler(2));
      await writeAgent(AGENT, linking());
      const locators: [string, NamedPathsOptions['transcript']][] = [
        ['rejects', () => Promise.reject(new Error('index closed'))],
        ['throws', () => {
          throw new Error('index closed');
        }],
      ];
      for (const [how, transcript] of locators) {
        const located = vi.fn();
        expect(await paths({ transcript }).namesInAgent(S, agent(), P, undefined, located), how).toBe(false);
        expect(located, how).toHaveBeenCalledTimes(1);
      }
      const located = vi.fn();
      expect(await paths().namesInAgent(S, agent(), P, undefined, located), 'the control').toBe('counted');
      expect(located).toHaveBeenCalledTimes(1);
    });

    it('at once when no locator call is made: a client already ended, a path past NAMED_PATH_MAX', async () => {
      await writeTranscript(filler(2));
      const long = `/work/out/${'d'.repeat(NAMED_PATH_MAX)}.md`;
      await writeAgent(AGENT, [...linking(), sidechain(linkTo(long))]);
      const locate = vi.fn(async () => file);
      const named = paths({ transcript: locate });
      for (const [why, path, signal] of [['ended', P, AbortSignal.abort()], ['too long', long, undefined]] as const) {
        const located = vi.fn();
        expect(await named.namesInAgent(S, agent(), path, signal, located), why).toBe(false);
        expect(located, why).toHaveBeenCalledTimes(1);
      }
      expect(locate).not.toHaveBeenCalled();
      expect(await named.namesInAgent(S, agent(), P), 'the control').toBe('counted');
    });
  });
});

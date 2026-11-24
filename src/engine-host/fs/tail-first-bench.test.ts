// The time to a long transcript's first window, before and after tail-first (tail-first.ts; docs/doperpowers/plans/
// 2026-10-30-long-transcript-window.md, Decision Log): a generated transcript of a few hundred MB in the shapes of the
// probe fixtures (prompts, tool calls with their results, replies, turn ends, and the silent records the engine writes
// between them: request blobs and shapes, queue operations, file-history snapshots), synthetic content only. "Before"
// is a read that takes no provisional window, as the renderer read before: the first answer, and when that is the empty
// page of a follow still reading, the answer asked again at the follow's `following`. "After" takes one. Each on a
// fresh service, the file in the page cache. A measured bound: macOS only (the unit:darwin lane, gate-offload §6), each
// number printed with the 1-minute load average; MAWS_TAIL_BENCH_MB resizes the file.
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { StoreFixture } from '../../../test/support/store-fixture';
import { slugOf } from './paths';
import { FsService } from './service';
import { DEBOUNCE_MS, SETTLE_MS } from './watcher';

const SESSION = '44444444-4444-4444-8444-444444444444' as SessionId;
const DIR = '/work/bench';
const APP = 'app-bench' as AppSessionId;
const MB = Number(process.env.MAWS_TAIL_BENCH_MB ?? 300);
const report = (name: string, value: unknown) => console.log(`[tail-first bench] ${name}: ${JSON.stringify(value)} (load ${loadavg()[0]!.toFixed(1)})`);

// One turn of about 130 KB, a third of it records the follower skips unparsed (as in the long transcripts measured): a
// prompt, eight tool calls each with its request records and a 10 KB result, a reply and the turn's end. Returns the lines and the turn's last uuid.
function turn(n: number, parent: string | null): { text: string; last: string } {
  const ts = new Date(Date.parse('2026-09-01T00:00:00.000Z') + n * 60_000).toISOString();
  const base = { sessionId: SESSION, cwd: DIR, version: '2.1.322', isSidechain: false, userType: 'external', timestamp: ts };
  const lines: unknown[] = [{ type: 'queue-operation', operation: 'enqueue', sessionId: SESSION, timestamp: ts, content: `prompt ${n}` }];
  lines.push({ ...base, type: 'user', uuid: `u${n}`, parentUuid: parent, message: { role: 'user', content: `prompt ${n} ${'p'.repeat(400)}` } });
  let last = `u${n}`;
  for (let k = 0; k < 8; k++) {
    const use = `toolu_${n}_${k}`;
    lines.push({ type: 'api-request-shape', sessionId: SESSION, id: `r${n}_${k}`, shape: { tools: 40, messages: n * 10 + k } });
    lines.push({ type: 'api-request-blob', sessionId: SESSION, id: `r${n}_${k}`, blob: 'b'.repeat(3_000) });
    lines.push({ type: 'api-request', sessionId: SESSION, id: `r${n}_${k}`, params: { body: 'q'.repeat(1_500) } });
    lines.push({ ...base, type: 'assistant', uuid: `t${n}_${k}`, parentUuid: last, message: { id: `msg_${n}_${k}`, role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: use, name: 'Read', input: { file_path: `/work/bench/file${k}.ts` } }] } });
    lines.push({ ...base, type: 'user', uuid: `r${n}_${k}`, parentUuid: `t${n}_${k}`, sourceToolAssistantUUID: `t${n}_${k}`, toolUseResult: { type: 'text', file: { filePath: `/work/bench/file${k}.ts` } }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: use, content: 'line of code\n'.repeat(800) }] } });
    last = `r${n}_${k}`;
  }
  lines.push({ ...base, type: 'assistant', uuid: `a${n}`, parentUuid: last, message: { id: `msg_${n}`, role: 'assistant', model: 'm', content: [{ type: 'text', text: `reply ${n} ${'a'.repeat(600)}` }] } });
  lines.push({ ...base, type: 'system', subtype: 'turn_duration', uuid: `d${n}`, parentUuid: `a${n}`, durationMs: 1000 });
  lines.push({ type: 'file-history-snapshot', messageId: `u${n}`, snapshot: { messageId: `u${n}`, trackedFileBackups: { 'file0.ts': { backupFileName: 'x', version: n } } }, isSnapshotUpdate: false });
  return { text: `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, last: `d${n}` };
}

async function generate(fixture: StoreFixture): Promise<number> {
  await fixture.addTranscript(DIR, SESSION, [turn(0, null).text.trimEnd()]);
  const path = join(fixture.paths.projects, slugOf(DIR), `${SESSION}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  const out = createWriteStream(path, { flags: 'a' });
  let bytes = 0;
  let parent = 'd0';
  for (let n = 1; bytes < MB * 1024 * 1024; n++) {
    const next = turn(n, parent);
    parent = next.last;
    bytes += next.text.length;
    if (!out.write(next.text)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
  }
  await new Promise((resolve) => out.end(resolve));
  await readFile(path); // into the page cache
  return bytes;
}

// The time from the first read to a window the transcript draws, on a fresh service.
async function firstWindow(fixture: StoreFixture, provisional: boolean): Promise<{ ms: number; events: number; provisional: boolean }> {
  let following: (() => void) | null = null;
  let followed = false;
  const fs = new FsService({
    paths: fixture.paths,
    emit: (name, payload) => {
      if (name === 'fs.followState' && (payload as { state: string }).state === 'following') {
        followed = true;
        following?.();
      }
      return true;
    },
  });
  await fs.start();
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + DEBOUNCE_MS + 50));
  fs.bind([{ sessionId: SESSION, appSessionId: APP }]);
  try {
    const started = performance.now();
    let page = await fs.eventsSnapshot(APP, null, provisional ? { provisional: true } : {});
    if (page.events.length === 0) {
      if (!followed) await new Promise<void>((resolve) => (following = resolve));
      page = await fs.eventsSnapshot(APP, null);
    }
    return { ms: Math.round(performance.now() - started), events: page.events.length, provisional: page.provisional === true };
  } finally {
    fs.stop();
  }
}

// macOS: a measured bound (a wall-clock budget on the Mac lane's hardware), as gate-offload §6 lists them
describe.skipIf(process.platform !== 'darwin')('the first window of a long transcript', () => {
  it(`${MB} MB: from its end in a fraction of the read from its start`, { timeout: 10 * 60_000 }, async () => {
    const fixture = await StoreFixture.create();
    try {
      const bytes = await generate(fixture);
      const before = await firstWindow(fixture, false);
      const after = await firstWindow(fixture, true);
      report('transcript MB', Math.round(bytes / 1024 / 1024));
      report('before', before);
      report('after', after);
      expect(after.provisional).toBe(true);
      expect(after.events).toBe(before.events); // the same window's size
      expect(after.ms).toBeLessThan(1_000);
      expect(after.ms * 3).toBeLessThan(before.ms);
    } finally {
      await fixture.dispose();
    }
  });
});

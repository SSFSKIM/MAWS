// The scale gate's host seam (M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; Acceptance 6): requested only
// under MAWS_E2E=1 and MAWS_DOCUMENT_PERF=1; it seeds a document over the host's first tab, runs agent sessions' document
// tools through their real `call` (the read, then batches from the revision the session last saw), measures the host's
// event loop around each call, answers the heap after a collection, and ends a session's replicas; commands arrive as
// files in `<userData>/document-perf/in` and are answered in `out`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDoc, TAB } from '@artifacts/document/writer.fixture';
import { listTabs } from '@artifacts/document/tabs';
import { DocIndex } from '@artifacts/document/block-index';
import { stateV2 } from '@artifacts/yjs';
import { HUMAN, openDocumentWorld, type DocumentWorld } from './document-world.fixture';
import { DocumentPerfSeam, documentPerfSeamRequested, startDocumentPerfSeam, type CallAnswer } from './document-perf';
import { hostWorkBetween, timed } from '../host-work'; // P4-R6

let world: DocumentWorld;
beforeEach(() => {
  world = openDocumentWorld();
});
afterEach(() => world.close());

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** An owner-made document once the host wrote its first tab (the kind's `created` listener). */
async function emptyDocument(): Promise<string> {
  const { id } = await world.store.create({ kind: 'document', title: 'Scale' }, HUMAN);
  for (let k = 0; k < 50 && listTabs(world.service.live(id)).length === 0; k++) await settle();
  expect(listTabs(world.service.live(id))).toHaveLength(1);
  return id;
}

describe('documentPerfSeamRequested', () => {
  it('is requested only under both the e2e mark and the scale flag', () => {
    expect(documentPerfSeamRequested({ MAWS_E2E: '1', MAWS_DOCUMENT_PERF: '1' })).toBe(true);
    expect(documentPerfSeamRequested({ MAWS_E2E: '1' })).toBe(false);
    expect(documentPerfSeamRequested({ MAWS_DOCUMENT_PERF: '1' })).toBe(false);
    expect(documentPerfSeamRequested({ MAWS_E2E: '0', MAWS_DOCUMENT_PERF: '1' })).toBe(false);
  });
});

describe('the seam’s commands', () => {
  it('seeds a document over its first tab: the seed’s tabs only, as the human', async () => {
    const id = await emptyDocument();
    const seam = new DocumentPerfSeam(world.store);
    const answer = await seam.run({ cmd: 'seed', artifactId: id, state: Buffer.from(stateV2(seedDoc())).toString('base64') });
    expect(answer).toMatchObject({ ok: true });
    expect(listTabs(world.service.live(id)).map((tab) => tab.id)).toEqual([TAB]);
    expect((answer as { revision: number }).revision).toBe(world.store.revision(id));
  });

  it('runs a session’s read and a batch from the revision it last saw, measuring the host’s loop around each call', async () => {
    const id = await emptyDocument();
    const seam = new DocumentPerfSeam(world.store);
    await seam.run({ cmd: 'seed', artifactId: id, state: Buffer.from(stateV2(seedDoc())).toString('base64') });
    const read = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_read', args: { artifact: id } })) as CallAnswer & { result: { revision: number; markdown: string } };
    expect(read).toMatchObject({ ok: true, isError: false });
    expect(read.result.markdown).toContain('^');
    expect(read.wallMs).toBeGreaterThan(0);
    expect(read.loop.max).toBeGreaterThanOrEqual(0);
    expect(DocIndex.of(world.service.live(id)).find('p1')).toBeTruthy(); // the seed's paragraph the batch inserts after
    const edit = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_edit', args: { artifact: id, baseRevision: 'last', ops: [{ op: 'insert', after: 'p1', markdown: 'Inserted by the seam.' }] } })) as CallAnswer & { result: { revision: number } };
    expect(edit).toMatchObject({ ok: true, isError: false });
    expect(edit.result.revision).toBeGreaterThan(read.result.revision);
    expect(world.store.revision(id)).toBe(edit.result.revision);
    // the batch was the session's: its replica exists until the session is released
    const released = await seam.run({ cmd: 'release', session: 'perf-agent-1' });
    expect(released).toMatchObject({ ok: true });
  });

  // M9's review: a call that blocks the loop at once (before any timer of the sampler fired) is still measured.
  it('measures a call’s synchronous work from its first moment', async () => {
    const blocking = { call: async () => {
      const until = performance.now() + 80;
      while (performance.now() < until); // the loop held 80 ms before the call's first await
      return { content: [{ type: 'text' as const, text: '{"revision":1}' }] };
    } };
    const seam = new DocumentPerfSeam(world.store, { tools: () => ({ artifact_read: blocking, artifact_edit: blocking }) as never });
    const answer = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_read', args: {} })) as CallAnswer;
    expect(answer.loop.max).toBeGreaterThanOrEqual(70);
    seam.close();
  });

  // P4-R6: a slow row names what shared its loop. The work inside the call's longest gap is listed (when it began, how
  // long, what it did); the call's work is summed by kind; work before the call is not counted.
  it('names the host’s work that shared a call’s longest gap, and sums the call’s work by kind', async () => {
    const spin = (ms: number) => {
      const until = performance.now() + ms;
      while (performance.now() < until);
    };
    const tool = {
      call: async () => {
        timed('warm', () => spin(4));
        await new Promise((resolve) => setTimeout(resolve, 10)); // the loop turns: a gap of its own
        timed('mirror', () => spin(60), () => 'a document’s text');
        timed('commit', () => spin(5));
        return { content: [{ type: 'text' as const, text: '{"revision":1}' }] };
      },
    };
    const seam = new DocumentPerfSeam(world.store, { tools: () => ({ artifact_read: tool, artifact_edit: tool }) as never });
    timed('head', () => spin(20)); // before the call: not its
    const answer = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_edit', args: {} })) as CallAnswer;
    const { longest, call } = answer.background;
    expect(longest?.ms).toBeCloseTo(answer.loop.max, 0);
    expect(longest?.ms).toBeGreaterThanOrEqual(60);
    const named = longest!.work.filter((entry) => entry.what !== 'gc'); // V8's collections land where they land
    expect(named.map((entry) => entry.what)).toEqual(['mirror', 'commit']);
    expect(named[0]).toMatchObject({ what: 'mirror', detail: 'a document’s text' });
    expect(named[0]!.ms).toBeGreaterThanOrEqual(59);
    expect(named[0]!.at).toBeGreaterThanOrEqual(10); // after the call's turn
    expect(Object.keys(call).filter((what) => what !== 'gc').sort()).toEqual(['commit', 'mirror', 'warm']);
    expect(call.warm).toMatchObject({ count: 1 });
    // the main thread ran through the gap, where the platform tells it (Node 23.9 and later)
    if (longest?.cpuMs !== null) expect(longest!.cpuMs!).toBeGreaterThan(0.8 * longest!.ms - 5);
    seam.close();
  });

  // P4-R6 (the review's P2): a call longer than the record's two-second horizon keeps its whole window
  it('keeps a long call’s work in its record past the record’s horizon', { timeout: 10_000 }, async () => {
    const spin = (ms: number) => {
      const until = performance.now() + ms;
      while (performance.now() < until);
    };
    const tool = {
      call: async () => {
        timed('mirror', () => spin(60));
        await new Promise((resolve) => setTimeout(resolve, 2_100));
        timed('commit', () => spin(5));
        return { content: [{ type: 'text' as const, text: '{"revision":1}' }] };
      },
    };
    const seam = new DocumentPerfSeam(world.store, { tools: () => ({ artifact_read: tool, artifact_edit: tool }) as never });
    const answer = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_edit', args: {} })) as CallAnswer;
    expect(answer.background.longest?.work.filter((entry) => entry.what !== 'gc').map((entry) => entry.what)).toEqual(['mirror']);
    expect(Object.keys(answer.background.call).filter((what) => what !== 'gc').sort()).toEqual(['commit', 'mirror']);
    expect(answer.background.partial).toBeUndefined();
    seam.close();
  });

  // P4-R6: a first read's replica applies the whole document from the host after the read, a stretch the record names
  it('records a first read’s replica sync, the whole document applied on the agent’s replica, as the host’s work', async () => {
    const id = await emptyDocument();
    const seam = new DocumentPerfSeam(world.store);
    await seam.run({ cmd: 'seed', artifactId: id, state: Buffer.from(stateV2(seedDoc())).toString('base64') });
    const from = performance.now();
    await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_read', args: { artifact: id } });
    await settle();
    const { work } = hostWorkBetween(from, performance.now());
    expect(work.some((entry) => entry.what === 'replica' && /^step2, \d+ bytes$/.test(entry.detail ?? ''))).toBe(true);
    expect(work.some((entry) => entry.what === 'frame' && /^step1, \d+ bytes from session:perf-agent-1$/.test(entry.detail ?? ''))).toBe(true);
    expect(work.some((entry) => entry.what === 'commit')).toBe(true);
    seam.close();
  });

  it('answers the loop’s longest gap over a run since its reset', async () => {
    const seam = new DocumentPerfSeam(world.store);
    await seam.run({ cmd: 'loop', reset: true });
    await settle();
    const until = performance.now() + 60;
    while (performance.now() < until); // a block between two commands
    await settle();
    const answer = (await seam.run({ cmd: 'loop' })) as { ok: true; loop: { max: number } };
    expect(answer.loop.max).toBeGreaterThanOrEqual(50);
    seam.close();
  });

  it('answers a refusal as the tool’s error text, not a seam failure', async () => {
    const id = await emptyDocument();
    const seam = new DocumentPerfSeam(world.store);
    const answer = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_edit', args: { artifact: id, baseRevision: 0, ops: [{ op: 'delete', id: 'nope' }] } })) as CallAnswer;
    expect(answer).toMatchObject({ ok: true, isError: true });
    expect(answer.text).toContain('nope');
  });

  // P4-A2 (X35; R12): a call's input streamed to the session's provisional emitter as the engine's deltas would arrive,
  // then committed by a call under the same tool-use id; another streamed and dropped
  it('streams a call’s input to the document’s ports, then commits it under the same id, or drops it', async () => {
    const id = await emptyDocument();
    const seam = new DocumentPerfSeam(world.store);
    await seam.run({ cmd: 'seed', artifactId: id, state: Buffer.from(stateV2(seedDoc())).toString('base64') });
    const read = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_read', args: { artifact: id } })) as CallAnswer & { result: { revision: number } };
    const end = world.connect(id, HUMAN);
    const states = () => end.received.flatMap((frame) => (frame.type === 'provisional' ? [(JSON.parse(frame.json) as { toolUseId: string; state: string }).state] : []));
    const args = { artifact: id, baseRevision: read.result.revision, ops: [{ op: 'insert', after: 'p1', markdown: 'Streamed in by the seam.' }] };
    const text = JSON.stringify(args);
    expect(await seam.run({ cmd: 'stream', session: 'perf-agent-1', toolUseId: 'toolu_seam_1', name: 'artifact_edit', deltas: [text.slice(0, -12), text.slice(-12)] })).toEqual({ ok: true, frames: 2 });
    expect(states()).toEqual(['streaming', 'streaming']);
    const edit = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_edit', args: { ...args, toolUseId: 'toolu_seam_1' } })) as CallAnswer & { result: { revision: number } };
    expect(edit).toMatchObject({ ok: true, isError: false });
    expect(states()).toEqual(['streaming', 'streaming', 'committed']);
    await seam.run({ cmd: 'stream', session: 'perf-agent-1', toolUseId: 'toolu_seam_2', name: 'artifact_edit', deltas: [text] });
    expect(await seam.run({ cmd: 'drop', session: 'perf-agent-1', toolUseId: 'toolu_seam_2' })).toEqual({ ok: true });
    expect(states()).toEqual(['streaming', 'streaming', 'committed', 'streaming', 'dropped']);
    seam.close();
  });

  it('answers the heap after a collection', async () => {
    const seam = new DocumentPerfSeam(world.store);
    const answer = (await seam.run({ cmd: 'heap' })) as { ok: true; heapUsed: number; rss: number; collected: boolean };
    expect(answer.ok).toBe(true);
    expect(answer.heapUsed).toBeGreaterThan(0);
    expect(answer.rss).toBeGreaterThan(answer.heapUsed);
    expect(answer.collected).toBe(true);
  });

  it('answers an unknown command as a failure naming it', async () => {
    const seam = new DocumentPerfSeam(world.store);
    expect(await seam.run({ cmd: 'nope' } as never)).toEqual({ ok: false, error: 'unknown command "nope"' });
  });
});

describe('the file channel', () => {
  it('answers each command file in `out` under the same name, in arrival order', { timeout: 30_000 }, async () => {
    const dir = join(world.dir, 'document-perf');
    const seam = startDocumentPerfSeam(world.store, dir);
    try {
      const send = (name: string, command: unknown) => {
        writeFileSync(join(dir, 'in', `${name}.tmp`), JSON.stringify(command));
        renameSync(join(dir, 'in', `${name}.tmp`), join(dir, 'in', `${name}.json`));
      };
      expect(existsSync(join(dir, 'in'))).toBe(true);
      mkdirSync(join(dir, 'out'), { recursive: true });
      send('000001', { cmd: 'heap' });
      send('000002', { cmd: 'nope' });
      const answerOf = async (name: string) => {
        for (let k = 0; k < 1_000; k++) { // up to 20 s: a loaded machine's file watch is slow
          const path = join(dir, 'out', `${name}.json`);
          if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
          await settle();
        }
        throw new Error(`no answer ${name}`);
      };
      expect(await answerOf('000001')).toMatchObject({ ok: true });
      expect(await answerOf('000002')).toEqual({ ok: false, error: 'unknown command "nope"' });
      expect(existsSync(join(dir, 'in', '000001.json'))).toBe(false);
    } finally {
      seam.close();
    }
  });
});

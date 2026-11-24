// Tail-first (tail-first.ts; docs/doperpowers/plans/2026-10-30-long-transcript-window.md, Decision Log): a read that takes a
// provisional window is answered from the transcript's end while the follow reads it from the start, and the answer is
// the window that read then answers, event for event, or there is none: the tail steps up its ladder or leaves the
// answer to the read from the start. The shapes the tail cannot see past (a rewind or a branch to before it, a turn
// longer than it, a task started before it) each fall back; an `Agent` tool use's child is found without the listing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { WindowBudget } from '@shared/graph/history-window';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { longTranscript, turnLines, LONG_DIR as DIR, LONG_SESSION as SESSION } from '../../../test/support/long-transcript';
import { StoreFixture } from '../../../test/support/store-fixture';
import { FsService } from './service';
import { DEBOUNCE_MS, SETTLE_MS } from './watcher';

const APP = 'app-tail' as AppSessionId;
const SMALL: WindowBudget = { soft: 16 * 1024, hard: 64 * 1024 }; // about six turns of the support's shape
const KIB = 1024;
const RUNGS = [24 * KIB, 96 * KIB, 384 * KIB];
type Emitted = { [N in EventName]: { name: N; payload: EventPayload<N> } }[EventName];
const ts = (n: number) => new Date(Date.parse('2026-09-01T00:00:00.000Z') + n * 1000).toISOString();
const base = (n: number) => ({ sessionId: SESSION, cwd: DIR, version: '2.1.312', isSidechain: false, userType: 'external', timestamp: ts(n) });

describe('a provisional window read from the transcript\'s end', () => {
  let fixture: StoreFixture;
  let service: FsService | null;
  let emitted: Emitted[];
  beforeEach(async () => {
    fixture = await StoreFixture.create();
    service = null;
    emitted = [];
  });
  afterEach(async () => {
    service?.stop();
    await fixture.dispose();
  });

  const start = async () => {
    service = new FsService({ paths: fixture.paths, emit: (name, payload) => (emitted.push({ name, payload } as Emitted), true), window: SMALL, tailRungs: RUNGS });
    await service.start();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + DEBOUNCE_MS + 50));
    service.bind([{ sessionId: SESSION, appSessionId: APP }]);
    return service;
  };
  const followed = async () => {
    for (let tries = 0; tries < 200; tries++) {
      if (emitted.some((e) => e.name === 'fs.followState' && e.payload.appSessionId === APP && e.payload.state === 'following')) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the follow never read the transcript through');
  };
  // The provisional answer, and the window the read from the start answers once it is done.
  const both = async (lines: string[]) => {
    await fixture.addTranscript(DIR, SESSION, lines);
    const fs = await start();
    const first = await fs.eventsSnapshot(APP, null, { provisional: true });
    await followed();
    const full = await fs.eventsSnapshot(APP, null);
    return { first, full };
  };
  // A provisional answer is the read from the start's window, event for event, with its cursor.
  const sameWindow = (first: { events: SessionEvent[]; earlier?: string }, full: { events: SessionEvent[]; earlier?: string }) => {
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(full.events));
    expect(first.earlier).toBe(full.earlier);
  };

  it('answers the newest window from the tail before the follow has read the file, the same window it then answers', async () => {
    const { first, full } = await both(longTranscript(200)); // about 600 KB
    expect(first.provisional).toBe(true);
    expect(first.complete).toBe(false);
    expect(first.cronHistory).toBeUndefined();
    expect(full.complete).toBe(true);
    expect(full.provisional).toBeUndefined();
    sameWindow(first, full);
    expect(first.events.at(-1)?.kind).toBe('process.exited'); // the synthesised end of a transcript nobody writes, as the full read's
  });

  it('answers as before to a read that does not take a provisional window', async () => {
    await fixture.addTranscript(DIR, SESSION, longTranscript(200));
    const fs = await start();
    const plain = await fs.eventsSnapshot(APP, null);
    expect(plain.provisional).toBeUndefined();
    expect(plain.complete).toBe(true);
  });

  it('leaves a transcript no longer than the first rung to the read from the start', async () => {
    const { first } = await both(longTranscript(4)); // about 12 KB
    expect(first.provisional).toBeUndefined();
    expect(first.complete).toBe(true);
  });

  it('a rewind whose target is before the tail steps the ladder up to it', async () => {
    // a terminal /rewind: the newest prompts are parented on turn 190's end, so the window reaches back to turn 191,
    // about 36 KB from the end (past the 24 KiB rung)
    const { first, full } = await both(longTranscript(200, { rewindTo: 190 }));
    expect(full.events.some((event) => event.kind === 'boundary.rewind')).toBe(true);
    expect(full.events[0]).toMatchObject({ kind: 'turn.started', userMessageUuid: 'u191' });
    expect(first.provisional).toBe(true); // read at the 96 KiB rung, which holds the target
    sameWindow(first, full);
  });

  it('a rewind to before every rung leaves the answer to the read from the start', async () => {
    const { first, full } = await both(longTranscript(200, { rewindTo: 20 }));
    expect(first.provisional).toBeUndefined();
    sameWindow(first, full);
  });

  it('a compaction in the window, its chain restarting there, maps as the read from the start maps it', async () => {
    const { first, full } = await both(longTranscript(200, { compactAt: 198 }));
    expect(full.events.some((event) => event.kind === 'boundary.compaction')).toBe(true);
    expect(first.provisional).toBe(true);
    sameWindow(first, full);
  });

  it('a newest turn longer than a rung steps up; one longer than every rung is left to the read from the start', async () => {
    const reply = (n: number, kib: number, parent: string) => JSON.stringify({ ...base(n), type: 'assistant', uuid: `big${n}`, parentUuid: parent, message: { id: `msg_big${n}`, role: 'assistant', model: 'm', content: [{ type: 'text', text: 'y'.repeat(kib * KIB) }] } });
    const prompt = (n: number, parent: string) => JSON.stringify({ ...base(n), type: 'user', uuid: `p${n}`, parentUuid: parent, message: { role: 'user', content: `prompt ${n}` } });
    // a 40 KiB reply: past the first rung, within the second (with the turns before it the window needs)
    const within = await both([...longTranscript(200), prompt(201, 'd200'), reply(201, 40, 'p201')]);
    expect(within.first.provisional).toBe(true);
    sameWindow(within.first, within.full);
    service?.stop();
    service = null;
    emitted = [];
    await fixture.dispose();
    fixture = await StoreFixture.create();
    // past the window's hard cap too: the read from the start cuts it, and the tail never answers a cut turn
    const past = await both([...longTranscript(200), prompt(201, 'd200'), reply(201, 300, 'p201')]);
    expect(past.first.provisional).toBeUndefined();
    sameWindow(past.first, past.full);
  });

  it('a branch from before the tail inside its window leaves it to the next rung or the read from the start', async () => {
    // the newest prompt continues turn 30's end: nothing in any rung roots it, and the read from the start reads a rewind
    const lines = [...longTranscript(200), ...turnLines(201, 'd30', 201).lines];
    const { first, full } = await both(lines);
    expect(first.provisional).toBeUndefined();
    sameWindow(first, full);
  });

  it('a background task started before the tail and ending in its window steps up to its start', async () => {
    const use = 'toolu_bg';
    const agentLines = (n: number, parent: string) => [
      JSON.stringify({ ...base(n), type: 'user', uuid: `u${n}`, parentUuid: parent, message: { role: 'user', content: `prompt ${n}` } }),
      JSON.stringify({ ...base(n), type: 'assistant', uuid: `t${n}`, parentUuid: `u${n}`, message: { id: `msg_t${n}`, role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: use, name: 'Agent', input: { description: 'd', prompt: 'p', subagent_type: 'general-purpose', run_in_background: true } }] } }),
      JSON.stringify({ ...base(n), type: 'user', uuid: `r${n}`, parentUuid: `t${n}`, toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'bg1' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: use, content: 'Async agent launched successfully.' }] } }),
      JSON.stringify({ ...base(n), type: 'system', subtype: 'turn_duration', uuid: `d${n}`, parentUuid: `r${n}`, durationMs: 1000 }),
    ];
    const notified = (n: number, parent: string) => JSON.stringify({ ...base(n), type: 'user', uuid: `n${n}`, parentUuid: parent, message: { role: 'user', content: `<task-notification>\n<task-id>bg1</task-id>\n<tool-use-id>${use}</tool-use-id>\n<status>completed</status>\n<summary>Agent "d" finished</summary>\n</task-notification>` } });
    // turns 1 to 120, the launch at 121, turns 122 to 200 after it, and the agent's end at 201
    const lines = [...longTranscript(120), ...agentLines(121, 'd120')];
    let parent = 'd121';
    for (let n = 122; n <= 200; n++) {
      const turn = turnLines(n, parent, n);
      lines.push(...turn.lines);
      parent = turn.last;
    }
    lines.push(notified(201, parent));
    await fixture.addTranscript(DIR, SESSION, lines);
    await fixture.addSidecar(SESSION, 'subagents/agent-bg1.jsonl', `${JSON.stringify({ type: 'user', uuid: 'c1', parentUuid: null, isSidechain: true, timestamp: ts(121), message: { role: 'user', content: 'p' } })}\n`);
    await fixture.addSidecar(SESSION, 'subagents/agent-bg1.meta.json', { agentType: 'general-purpose', description: 'd', toolUseId: use, spawnDepth: 1, requestShape: 'background' });
    const fs = await start();
    const first = await fs.eventsSnapshot(APP, null, { provisional: true });
    await followed();
    const full = await fs.eventsSnapshot(APP, null);
    expect(full.events.some((event) => event.kind === 'subagent.finished')).toBe(true);
    // the start is about 240 KB back: past the first two rungs, inside the third
    expect(first.provisional).toBe(true);
    sameWindow(first, full);
  });

  it('finds an `Agent` tool use\'s child among the agents written since it, without the session\'s listing', async () => {
    const use = 'toolu_fg';
    const lines = [
      ...longTranscript(200),
      JSON.stringify({ ...base(201), type: 'user', uuid: 'u201', parentUuid: 'd200', message: { role: 'user', content: 'prompt 201' } }),
      JSON.stringify({ ...base(201), type: 'assistant', uuid: 't201', parentUuid: 'u201', message: { id: 'msg_t201', role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: use, name: 'Agent', input: { description: 'look', prompt: 'look around', subagent_type: 'Explore' } }] } }),
    ];
    await fixture.addTranscript(DIR, SESSION, lines);
    await fixture.addSidecar(SESSION, 'subagents/agent-fg1.jsonl', `${JSON.stringify({ type: 'user', uuid: 'c1', parentUuid: null, isSidechain: true, timestamp: ts(201), message: { role: 'user', content: 'look around' } })}\n`);
    await fixture.addSidecar(SESSION, 'subagents/agent-fg1.meta.json', { agentType: 'Explore', description: 'look', toolUseId: use, spawnDepth: 1 });
    const fs = await start();
    const first = await fs.eventsSnapshot(APP, null, { provisional: true });
    expect(first.provisional).toBe(true);
    expect(first.events.find((event) => event.kind === 'subagent.started')).toMatchObject({ taskId: 'fg1', description: 'look', subagentType: 'Explore', prompt: 'look around' });
    await followed();
    sameWindow(first, await fs.eventsSnapshot(APP, null));
  });

  it('a branch from before the tail stays unrooted though a compaction restarted the chain after it', async () => {
    // a terminal /rewind to turn 30, then a compaction: the chain the tail ends on starts at the boundary, a root it
    // holds, but the branch above it in the window is still one the read from the start reads as a rewind
    const lines = [...longTranscript(200), ...turnLines(201, 'd30', 201).lines];
    lines.push(JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: 'c202', parentUuid: null, logicalParentUuid: 'd201', sessionId: SESSION, cwd: DIR, timestamp: ts(202), compactMetadata: { trigger: 'auto', preTokens: 1000 } }));
    lines.push(...turnLines(202, 'c202', 202).lines);
    const { first, full } = await both(lines);
    expect(first.provisional).toBeUndefined();
    sameWindow(first, full);
  });

  it('a tool result in the window whose call is before the tail is left to the next rung', async () => {
    const use = 'toolu_long';
    const lines = [
      ...longTranscript(149),
      JSON.stringify({ ...base(150), type: 'user', uuid: 'u150', parentUuid: 'd149', message: { role: 'user', content: 'prompt 150' } }),
      JSON.stringify({ ...base(150), type: 'assistant', uuid: 't150', parentUuid: 'u150', message: { id: 'msg_t150', role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: use, name: 'Read', input: { file_path: '/a' } }] } }),
    ];
    let parent = 't150';
    for (let n = 151; n <= 200; n++) {
      const turn = turnLines(n, parent, n);
      lines.push(...turn.lines);
      parent = turn.last;
    }
    // the call's result, written long after it (a resumed tool loop's shape), inside the newest turn
    lines.push(JSON.stringify({ ...base(201), type: 'user', uuid: 'r201', parentUuid: parent, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: use, content: 'late' }] } }));
    const { first, full } = await both(lines);
    expect(full.events.some((event) => event.kind === 'tool.result')).toBe(true);
    expect(first.provisional).toBe(true); // at the rung that holds the call (about 150 KB back: the third)
    sameWindow(first, full);
  });

  it('takes no tail for a session a follow is already reading: its window is that follow\'s cut of the file', async () => {
    await fixture.addTranscript(DIR, SESSION, longTranscript(200));
    const fs = await start();
    const reading = fs.eventsSnapshot(APP, null); // the follow starts
    const second = await fs.eventsSnapshot(APP, null, { provisional: true });
    expect(second.provisional).toBeUndefined();
    await reading;
  });
});

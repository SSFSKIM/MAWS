// A long transcript read through the fs service in bounded windows (docs/doperpowers/plans/2026-10-30-long-transcript-window.md):
// the backfill is held, not broadcast; its newest window goes out once; every answer is a window, and the pages before
// each cursor put the whole delivered history back together with no gap and no overlap; a quiet follow emits nothing;
// a follow outlives its session's interest by the release time only; and the silent request records are never parsed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { eventBytes, type WindowBudget } from '@shared/graph/history-window';
import type { AgentId, AppSessionId, EventId, SessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { StoreFixture } from '../../../test/support/store-fixture';
import { UNKNOWN_CURSOR } from './follow';
import { FsService } from './service';
import { DEBOUNCE_MS, SETTLE_MS } from './watcher';

const SESSION = '22222222-2222-4222-8222-222222222222' as SessionId;
const APP = 'app-long' as AppSessionId;
const DIR = '/work/long';
const PAD = 'x'.repeat(600); // each prompt and reply about 0.6 KB of event JSON

// One turn: a prompt parented on `parent`, a reply, and its turn_duration; the silent request record the engine writes
// per model call between them. Returns the lines and the turn's last uuid.
function turnLines(n: number, parent: string | null, at: number): { lines: string[]; last: string } {
  const ts = new Date(Date.parse('2026-09-01T00:00:00.000Z') + at * 1000).toISOString();
  const base = { sessionId: SESSION, cwd: DIR, version: '2.1.312', isSidechain: false, userType: 'external', timestamp: ts };
  return {
    lines: [
      JSON.stringify({ ...base, type: 'user', uuid: `u${n}`, parentUuid: parent, message: { role: 'user', content: `prompt ${n} ${PAD}` } }),
      JSON.stringify({ type: 'api-request', sessionId: SESSION, id: `r${n}`, params: { body: PAD } }),
      JSON.stringify({ ...base, type: 'assistant', uuid: `a${n}`, parentUuid: `u${n}`, message: { id: `msg_${n}`, role: 'assistant', model: 'm', content: [{ type: 'text', text: `reply ${n} ${PAD}` }] } }),
      JSON.stringify({ ...base, type: 'system', subtype: 'turn_duration', uuid: `d${n}`, parentUuid: `a${n}`, durationMs: 1000 }),
      JSON.stringify({ type: 'file-history-snapshot', messageId: `u${n}`, snapshot: { messageId: `u${n}`, trackedFileBackups: {} }, isSnapshotUpdate: false }),
    ],
    last: `d${n}`,
  };
}

// `turns` turns in one chain; with `rewindTo`, a last prompt parented on that turn's end (a terminal /rewind's shape) and
// one more turn after it.
function transcript(turns: number, options: { rewindTo?: number; compactAt?: number } = {}): string[] {
  const lines: string[] = [];
  let parent: string | null = null;
  for (let n = 1; n <= turns; n++) {
    if (n === options.compactAt) {
      const ts = new Date(Date.parse('2026-09-01T00:00:00.000Z') + n * 1000 - 500).toISOString();
      lines.push(JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: `c${n}`, parentUuid: null, logicalParentUuid: parent, sessionId: SESSION, cwd: DIR, timestamp: ts, compactMetadata: { trigger: 'auto', preTokens: 1000 } }));
      parent = `c${n}`;
    }
    const turn = turnLines(n, parent, n);
    lines.push(...turn.lines);
    parent = turn.last;
  }
  if (options.rewindTo !== undefined) {
    const rewound = turnLines(turns + 1, `d${options.rewindTo}`, turns + 1);
    lines.push(...rewound.lines);
    lines.push(...turnLines(turns + 2, rewound.last, turns + 2).lines);
  }
  return lines;
}

type Emitted = { [N in EventName]: { name: N; payload: EventPayload<N> } }[EventName];

describe('a long transcript is read in windows', () => {
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

  const SMALL: WindowBudget = { soft: 6 * 1024, hard: 64 * 1024 }; // about four of the turns above
  const start = async (options: { reconcileMs?: number } = {}) => {
    service = new FsService({
      paths: fixture.paths,
      emit: (name, payload) => {
        const checked = validateEventPayload(name, payload);
        if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
        emitted.push({ name, payload } as Emitted);
        return true;
      },
      window: SMALL,
      ...options,
    });
    await service.start();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + DEBOUNCE_MS + 50));
    service.bind([{ sessionId: SESSION, appSessionId: APP }]);
    return service;
  };
  const batches = () => emitted.flatMap((e) => (e.name === 'session.eventBatch' && e.payload.appSessionId === APP ? e.payload.events : []));
  const ids = (events: readonly SessionEvent[]) => events.map((e) => e.id);
  const userTexts = (events: readonly SessionEvent[]) => events.flatMap((e) => (e.kind === 'user.message' && typeof e.content === 'string' ? [e.content.split(' ').slice(0, 2).join(' ')] : []));

  // Every page from the newest back to the first, oldest first.
  async function allPages(fs: FsService): Promise<{ pages: SessionEvent[][]; whole: SessionEvent[] }> {
    const pages: SessionEvent[][] = [];
    let page = await fs.eventsSnapshot(APP, null);
    pages.unshift(page.events);
    while (page.earlier !== undefined) {
      page = await fs.eventsSnapshot(APP, null, { before: page.earlier });
      pages.unshift(page.events);
    }
    return { pages, whole: pages.flat() };
  }

  it('holds the backfill, sends only its newest window once, and pages back to the first event with no gap or overlap', async () => {
    await fixture.addTranscript(DIR, SESSION, transcript(40));
    const fs = await start();
    const first = await fs.eventsSnapshot(APP, null);
    expect(first.complete).toBe(true);
    expect(first.earlier).toBe(first.events[0]!.id);
    expect(first.events[0]!.kind).toBe('turn.started'); // whole turns
    expect(first.events.reduce((bytes, event) => bytes + eventBytes(event), 0)).toBeLessThanOrEqual(SMALL.soft);
    expect(userTexts(first.events).at(-1)).toBe('prompt 40');
    // The batches are the window, nothing older: the backfill was held.
    expect(ids(batches())).toEqual(ids(first.events));

    const { pages, whole } = await allPages(fs);
    expect(pages.length).toBeGreaterThan(5);
    expect(whole[0]!.kind).toBe('session.started');
    expect(new Set(ids(whole)).size).toBe(whole.length); // no overlap
    expect(userTexts(whole)).toEqual(Array.from({ length: 40 }, (_, i) => `prompt ${i + 1}`)); // no gap
    for (const page of pages.slice(1)) expect(page[0]!.kind).toBe('turn.started');
    expect(ids(batches())).toEqual(ids(first.events)); // paging sends nothing
  });

  it('answers the first N events for a limit, one agent\'s slice for an agent id, and refuses a cursor it never gave', async () => {
    await fixture.addTranscript(DIR, SESSION, transcript(12));
    const fs = await start();
    const firstFive = await fs.eventsSnapshot(APP, null, { limit: 5 });
    expect(firstFive.events).toHaveLength(5);
    expect(firstFive.events[0]!.kind).toBe('session.started');
    expect(firstFive.earlier).toBeUndefined();
    // The transcript has no agents: the slice is the parent's exits alone (none: its last turn ended)
    expect((await fs.eventsSnapshot(APP, null, { agentId: 'agent-1' as AgentId })).events).toEqual([]);
    await expect(fs.eventsSnapshot(APP, null, { before: 'nowhere' as EventId })).rejects.toThrow(UNKNOWN_CURSOR);
  });

  it('starts a window at the turn a rewind inside it rewound to', async () => {
    // 30 turns, then a prompt on turn 26's end: turns 27 to 30 are abandoned, the rewind's target is turn 27's prompt.
    await fixture.addTranscript(DIR, SESSION, transcript(30, { rewindTo: 26 }));
    const fs = await start();
    let page = await fs.eventsSnapshot(APP, null);
    const window = [...page.events];
    while (!window.some((e) => e.kind === 'boundary.rewind') && page.earlier !== undefined) {
      page = await fs.eventsSnapshot(APP, null, { before: page.earlier });
      window.unshift(...page.events);
    }
    const rewind = page.events.find((e) => e.kind === 'boundary.rewind');
    expect(rewind).toMatchObject({ kind: 'boundary.rewind', targetMessageUuid: 'u27' });
    // The page that carries the rewind also carries the turn it targets.
    expect(page.events.some((e) => e.kind === 'turn.started' && e.userMessageUuid === 'u27')).toBe(true);
  });

  it('pages across a compaction like any boundary', async () => {
    await fixture.addTranscript(DIR, SESSION, transcript(24, { compactAt: 12 }));
    const fs = await start();
    const { whole } = await allPages(fs);
    expect(whole.filter((e) => e.kind === 'boundary.compaction')).toHaveLength(1);
    expect(userTexts(whole)).toEqual(Array.from({ length: 24 }, (_, i) => `prompt ${i + 1}`));
  });

  it('reads a live session\'s older pages through a quiet follow that emits nothing', async () => {
    await fixture.addTranscript(DIR, SESSION, transcript(20));
    const fs = await start();
    const page = await fs.eventsSnapshot(APP, null, {}, true);
    expect(page.events.length).toBeGreaterThan(0);
    const older = await fs.eventsSnapshot(APP, null, { before: page.earlier! }, true);
    expect(older.events.length).toBeGreaterThan(0);
    expect(emitted.filter((e) => (e.name === 'session.eventBatch' || e.name === 'fs.followState') && e.payload.appSessionId === APP)).toEqual([]);
    await fs.unfollow(APP, null); // the session's unfollow stops its quiet follow too
    expect(fs.state().followed).toEqual([]);
  });

  it('never parses the silent request records, and parses a line that only mentions them later on', async () => {
    const lines = transcript(3);
    const mention = JSON.stringify({ type: 'user', uuid: 'm1', parentUuid: 'd3', sessionId: SESSION, cwd: DIR, message: { role: 'user', content: 'the line {"type":"api-request" and {"type":"file-history-snapshot" in a prompt' } });
    // Torn lines: one opening as a silent record is known by its first key and never parsed (so never counted as
    // skipped); one of another type that merely starts alike (`api-request-blob`) is parsed, fails and is counted.
    await fixture.addTranscript(DIR, SESSION, [...lines, mention, '{"type":"api-request","torn', '{"type":"file-history-snapshot","torn', '{"type":"api-request-blob","torn']);
    const fs = await start();
    const page = await fs.eventsSnapshot(APP, null);
    expect(userTexts(page.events).at(-1)).toBe('the line');
    expect(emitted.flatMap((e) => (e.name === 'fs.followState' && e.payload.appSessionId === APP ? [e.payload.skippedLines] : [])).at(-1)).toBe(1);
  });});

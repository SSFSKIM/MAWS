// A long transcript read through the fs service in bounded windows (docs/doperpowers/plans/2026-10-30-long-transcript-window.md):
// the backfill is held, not broadcast; its newest window goes out once; every answer is a window, and the pages before
// each cursor put the whole delivered history back together with no gap and no overlap; a quiet follow emits nothing;
// a follow outlives its session's interest by the release time only; and the silent request records are never parsed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { CRON_HISTORY_BYTES, eventBytes, FOLLOW_RELEASED, type WindowBudget } from '@shared/graph/history-window';
import type { AgentId, AppSessionId, EventId, MessageUuid, SessionId, TaskId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { longTranscript as transcript, LONG_SESSION as SESSION, LONG_DIR as DIR } from '../../../test/support/long-transcript';
import { StoreFixture } from '../../../test/support/store-fixture';
import { agentSlice, UNKNOWN_CURSOR } from './follow';
import { FsService, type InterestSource } from './service';
import { DEBOUNCE_MS, SETTLE_MS } from './watcher';

const APP = 'app-long' as AppSessionId;
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
  const start = async (options: { reconcileMs?: number; releaseMs?: number } = {}) => {
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

  it('says where each page stands to a message a jump seeks, so the walk back ends on its page, or at once when it is in none', async () => {
    await fixture.addTranscript(DIR, SESSION, transcript(40));
    const fs = await start();
    const first = await fs.eventsSnapshot(APP, null);
    expect(first.sought).toBeUndefined(); // the open asks nothing of the kind, and answers one window as before
    const target = 'a3' as MessageUuid; // turn 3's reply, many pages back
    let page = await fs.eventsSnapshot(APP, null, { before: first.earlier!, seek: target });
    expect(page.sought).toMatchObject({ at: 'earlier' });
    const behind = page.sought!.behind;
    const firstLength = page.events.length;
    let walked = 0;
    let pages = 1;
    while (page.sought?.at === 'earlier') {
      walked += page.events.length;
      page = await fs.eventsSnapshot(APP, null, { before: page.earlier!, seek: target });
      pages += 1;
    }
    expect(pages).toBeGreaterThan(3);
    expect(page.sought).toEqual({ at: 'page', behind: 0 });
    // `behind` counted the events between the first page asked and the message's first event
    const at = page.events.findIndex((e) => 'messageUuid' in e && e.messageUuid === target);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(behind).toBe(walked - firstLength + page.events.length - at);
    // Not in the history at all: said on the first page asked, with nothing walked
    expect((await fs.eventsSnapshot(APP, null, { before: first.earlier!, seek: 'gone' as MessageUuid })).sought).toEqual({ at: 'absent', behind: 0 });
    // At or after the cursor: in what the reader already holds
    expect((await fs.eventsSnapshot(APP, null, { before: first.earlier!, seek: 'a40' as MessageUuid })).sought).toEqual({ at: 'newer', behind: 0 });
  });

  it('carries on the newest window the cron calls before it, small and only there, the window itself one window within its budget', async () => {
    await fixture.addTranscript(DIR, SESSION, transcript(40, { cronAt: 3 })); // turn 3 schedules a job, many pages back
    const fs = await start();
    const first = await fs.eventsSnapshot(APP, null);
    expect(first.events.reduce((bytes, event) => bytes + eventBytes(event), 0)).toBeLessThanOrEqual(SMALL.soft); // the open: one window
    expect(userTexts(first.events)).not.toContain('prompt 3');
    const crons = first.cronHistory!;
    expect(crons.map((e) => e.kind)).toEqual(['turn.started', 'tool.use', 'tool.result']);
    expect(crons[0]).toMatchObject({ userMessageUuid: 'u3' });
    expect(crons[1]).toMatchObject({ toolName: 'CronCreate', input: { cron: '0 3 * * *', prompt: 'nightly check' } });
    expect(crons.reduce((bytes, event) => bytes + eventBytes(event), 0)).toBeLessThanOrEqual(CRON_HISTORY_BYTES);
    // the events are the follow's own, which the page that holds them brings again (deduplicated by id)
    const { whole } = await allPages(fs);
    expect(crons.every((event) => whole.some((e) => e.id === event.id))).toBe(true);
    // a page before a cursor carries none, nor a window with nothing older
    expect((await fs.eventsSnapshot(APP, null, { before: first.earlier! })).cronHistory).toBeUndefined();
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

  it('stops a follow once its session has been out of every client\'s interest for the release time', async () => {
    await fixture.addTranscript(DIR, SESSION, transcript(4));
    const fs = await start({ reconcileMs: 20, releaseMs: 150 });
    let set: ReadonlySet<AppSessionId> = new Set([APP]);
    const listeners = new Set<() => void>();
    const interest: InterestSource = { set: () => set, onChange: (listener) => (listeners.add(listener), () => listeners.delete(listener)) };
    fs.watchInterest(interest);
    await fs.eventsSnapshot(APP, null);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fs.state().followed).toEqual([{ appSessionId: APP, agentId: null }]); // held open: kept
    set = new Set();
    for (const listener of listeners) listener();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fs.state().followed).toEqual([{ appSessionId: APP, agentId: null }]); // within the release time
    await expect.poll(() => fs.state().followed, { timeout: 2000, interval: 20 }).toEqual([]);
    // Its stop says it was released, so a source still attached knows to read the history again.
    const lastState = () => emitted.flatMap((e) => (e.name === 'fs.followState' && e.payload.appSessionId === APP ? [e.payload] : [])).at(-1);
    expect(lastState()).toMatchObject({ state: 'stopped', message: FOLLOW_RELEASED });
    // A later read follows it again from the start.
    expect((await fs.eventsSnapshot(APP, null)).events.length).toBeGreaterThan(0);
    // Any other stop (a resume's unfollow) says nothing of a release.
    await fs.unfollow(APP, null);
    expect(lastState()).toMatchObject({ state: 'stopped', message: null });
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
  });
});

describe('one agent\'s slice of its parent\'s history', () => {
  const AGENT = 'agent-1' as AgentId;
  const base = (n: number, agentId: AgentId | null) => ({ id: `e${n}` as EventId, sessionId: SESSION as SessionId, at: new Date(Date.UTC(2026, 9, 30, 10, 0, n)).toISOString(), seq: null, agentId, parentToolUseId: null });
  const started = { ...base(0, AGENT), kind: 'subagent.started', taskId: AGENT as string as TaskId, toolUseId: null, description: 'Survey', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null } as SessionEvent;
  const own = (n: number) => ({ ...base(n, AGENT), kind: 'notice.posted', level: 'info', text: 'x'.repeat(200), key: null }) as SessionEvent;
  const parentsOwn = { ...base(11, null), kind: 'notice.posted', level: 'info', text: 'the parent', key: null } as SessionEvent;
  const exit = { ...base(12, null), kind: 'process.exited', code: 0, signal: null, reason: 'quit', lostAttentionCount: 0, budget: null } as SessionEvent;
  const events = [started, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(own), parentsOwn, exit];
  const ids = (slice: readonly SessionEvent[]) => slice.map((event) => event.id);

  it('keeps the child\'s start and the parent\'s exits past the cap, which cuts only the agent\'s own events, newest first', () => {
    const hard = [8, 9, 10].reduce((bytes, n) => bytes + eventBytes(own(n)), 0); // the agent's newest three
    expect(ids(agentSlice(events, AGENT, hard))).toEqual(['e0', 'e8', 'e9', 'e10', 'e12']);
    expect(ids(agentSlice(events, AGENT, null))).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e12']); // a live page: uncapped
  });
});

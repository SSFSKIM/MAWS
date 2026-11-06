// P5 O8 M7b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b, Interfaces §O): the spine's journal of
// to-human entries per org project. Lane B's come from the owner channel's event batches through the one extraction
// (`@shared/owner/to-human-items`) and its answered questions from the owner channel's state; lane A's are handed in
// (`record`). Each is recorded once (`UNIQUE(src)`), kept to the newest 2,000 per project and 30 days, and placed in its
// project by sminos's id through the org-project join. A real index in a temporary directory; the engine host's events and
// the services bus are stand-ins.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ProjectId, SessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { HostEntry, NewHostEntry } from '@shared/ipc/schema/channel';
import type { ProjectOrg } from '@shared/ipc/schema/session';
import type { OrgKey } from '@shared/machine/org-key';
import { answerText } from '@shared/owner/answer';
import { markIdOf } from '@shared/owner/marks';
import type { OwnerChannelState, OwnerMark } from '@shared/owner/state';
import { validateEventPayload } from '@shared/ipc/validate';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { CHANNEL_BOUNDS } from './journal';
import { startChannel, type ProjectChannel } from './register';

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const PLUGIN = 'mcp__to-human__message';

type Listener = (payload: unknown) => void;

function harness() {
  const dir = tempDir('maws-channel-');
  const index = new Index(join(dir.path, 'index.sqlite'));
  const host = new Map<string, Set<Listener>>();
  const taps = new Map<string, Set<Listener>>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: EventPayload<'channel.changed'>[] = [];
  let clock = NOW;
  const on = (table: Map<string, Set<Listener>>) => (name: string, listener: Listener) => {
    const set = table.get(name) ?? new Set();
    table.set(name, set.add(listener));
    return () => void set.delete(listener);
  };
  const channel: ProjectChannel = startChannel({
    index,
    onEvent: on(host) as never,
    onEmitted: on(taps) as never,
    register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
    emit: ((name: EventName, payload: EventPayload<'channel.changed'>) => {
      expect(name).toBe('channel.changed');
      expect(validateEventPayload(name, payload).ok, 'the event validates').toBe(true);
      emitted.push(payload);
      return true;
    }) as never,
    now: () => clock,
    log: () => {},
  });
  // a session in a checkout whose org project is sminos's `smnsId` (null: a project no org id joins)
  const session = (smnsId: string | null, engine = `00000000-0000-4000-8000-${Math.floor(Math.random() * 1e12).toString().padStart(12, '0')}`) => {
    const directory = join(dir.path, `checkout-${Math.random().toString(36).slice(2)}`);
    mkdirSync(directory);
    const record = index.sessions.upsertFromSummary(summary({ directory, sessionId: engine as SessionId })).record;
    const org: ProjectOrg = smnsId === null ? { key: `folder:m:${record.projectId}` as OrgKey, name: 'x', source: 'folder', smnsId: null } : { key: `smns:${smnsId}` as OrgKey, name: 'x', source: 'smns', smnsId };
    index.projects.setOrg(record.projectId as ProjectId, org);
    return { appSessionId: record.appId, engineSessionId: engine as SessionId };
  };
  const batch = (appSessionId: AppSessionId, events: SessionEvent[]) => {
    for (const listener of host.get('session.eventBatch') ?? []) listener({ appSessionId, events });
  };
  const ownerState = (state: OwnerChannelState) => {
    for (const listener of taps.get('ownerChannel.changed') ?? []) listener({ appSessionId: state.appSessionId, state });
  };
  const history = (input: { project: string; before?: string; limit?: number }) => handlers.get('channel.history')!(input) as { entries: HostEntry[]; more: boolean };
  return {
    index, channel, emitted, session, batch, ownerState, history, handlers,
    rows: () => {
      const raw = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
      try {
        return Number((raw.prepare('SELECT COUNT(*) AS n FROM channel_entries').get() as { n: number }).n);
      } finally {
        raw.close();
      }
    },
    tick: (ms: number) => void (clock += ms),
    dispose: () => {
      channel.stop();
      index.close();
      dir.dispose();
    },
  };
}

let seq = 0;
const ev = (engine: SessionId, at: string, body: Record<string, unknown>) =>
  ({ id: `ev-${++seq}`, sessionId: engine, at, seq, agentId: null, parentToolUseId: null, ...body }) as unknown as SessionEvent;
const block = (engine: SessionId, at: string, messageUuid: string, text: string, over: Record<string, unknown> = {}) =>
  ev(engine, at, { kind: 'assistant.block.complete', messageUuid, apiMessageId: `api-${messageUuid}`, blockIndex: 0, block: { type: 'text', text }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [], ...over });
const toolUse = (engine: SessionId, at: string, toolUseId: string, toolName: string, input: unknown, over: Record<string, unknown> = {}) =>
  ev(engine, at, { kind: 'tool.use', toolUseId, toolName, input, apiMessageId: 'api-t', messageUuid: `mu-${toolUseId}`, ...over });
const toolResult = (engine: SessionId, at: string, toolUseId: string, isError = false, over: Record<string, unknown> = {}) =>
  ev(engine, at, { kind: 'tool.result', toolUseId, content: [{ type: 'text', text: isError ? 'refused' : 'sent' }], isError, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: `res-${toolUseId}`, ...over });
const turnEnded = (engine: SessionId, at: string) =>
  ev(engine, at, { kind: 'turn.ended', result: 'success', isError: false, terminalReason: null, resultText: null, durationMs: 1, numTurns: 1, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, permissionDenials: [], errors: [], userMessageUuids: [] });

const laneA = (over: Partial<NewHostEntry> = {}): NewHostEntry => ({
  project: 'proj-a', appSessionId: null, engineSessionId: '11111111-1111-4111-8111-111111111111' as SessionId, lane: 'A', kind: 'message', text: 'From the terminal.',
  at: iso(NOW - 60_000), src: 'proj-a/mini/s1/7', ...over,
});

describe('the project channel journal', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => h.dispose());

  describe('lane B, from the owner channel’s event batches', () => {
    it('records a sent message-tool call once, in its session’s org project, at the call’s time, across a replay of its batches', () => {
      const { appSessionId, engineSessionId: e } = h.session('proj-1');
      const use = toolUse(e, iso(NOW - 5_000), 'toolu_m1', PLUGIN, { text: 'Stage 1 is done: **37** labels missing.', final: false });
      const result = toolResult(e, iso(NOW - 4_000), 'toolu_m1');
      h.batch(appSessionId, [use]);
      expect(h.emitted, 'nothing before the result says it was sent').toEqual([]);
      h.batch(appSessionId, [result]);
      h.batch(appSessionId, [use]); // a resync burst replays both batches
      h.batch(appSessionId, [result]);
      const { entries, more } = h.history({ project: 'proj-1' });
      expect(more).toBe(false);
      expect(entries).toEqual([
        { id: expect.any(String), project: 'proj-1', appSessionId, engineSessionId: e, lane: 'B', kind: 'message', text: 'Stage 1 is done: **37** labels missing.', at: iso(NOW - 5_000), src: `proj-1/lane-b/${appSessionId}/call/toolu_m1` },
      ]);
      expect(h.emitted).toEqual([{ project: 'proj-1', entry: entries[0] }]);
    });

    it('records MAWS’s former message tool alike, and no refused call, call without words, call whose result never came, subagent’s call or other tool', () => {
      const { appSessionId, engineSessionId: e } = h.session('proj-1');
      const at = iso(NOW - 9_000);
      h.batch(appSessionId, [
        toolUse(e, at, 'toolu_old', 'mcp__maws__message', { text: 'Recorded session.' }), toolResult(e, at, 'toolu_old'),
        toolUse(e, at, 'toolu_refused', PLUGIN, { text: 'Denied.' }), toolResult(e, at, 'toolu_refused', true),
        toolUse(e, at, 'toolu_blank', PLUGIN, { text: '  ' }), toolResult(e, at, 'toolu_blank'),
        toolUse(e, at, 'toolu_child', PLUGIN, { text: 'From a subagent.' }, { parentToolUseId: 'toolu_agent' }), toolResult(e, at, 'toolu_child', false, { parentToolUseId: 'toolu_agent' }),
        toolUse(e, at, 'toolu_bash', 'Bash', { text: 'ls' }), toolResult(e, at, 'toolu_bash'),
        toolUse(e, at, 'toolu_cut', PLUGIN, { text: 'Never answered.' }), turnEnded(e, at), // its result never comes
      ]);
      expect(h.history({ project: 'proj-1' }).entries.map((entry) => entry.text)).toEqual(['Recorded session.']);
    });

    it('records each message span of a finished text, once across a replay, and no essential, insight, plain word or API-error message', () => {
      const { appSessionId, engineSessionId: e } = h.session('proj-1');
      const text = 'Working.\n<message>The build is green.</message>\n<essential>Read me.</essential>\n<insight>Why.</insight>\n<message>Second one.</message>';
      const batch = [block(e, iso(NOW - 3_000), 'mu-1', text), block(e, iso(NOW - 2_000), 'mu-2', '<message>An API error.</message>', { isApiErrorMessage: true })];
      h.batch(appSessionId, batch);
      h.batch(appSessionId, batch);
      const { entries } = h.history({ project: 'proj-1' });
      expect(entries.map(({ kind, text: words, src }) => ({ kind, text: words, src }))).toEqual([
        { kind: 'message', text: 'Second one.', src: `proj-1/lane-b/${appSessionId}/text/mu-1/0/m1` },
        { kind: 'message', text: 'The build is green.', src: `proj-1/lane-b/${appSessionId}/text/mu-1/0/m0` },
      ]);
      expect(h.emitted).toHaveLength(2);
    });

    it('records a question as it was asked and its answer once the owner channel delivers it, each once; no answer to a question it never recorded', () => {
      const { appSessionId, engineSessionId: e } = h.session('proj-1');
      const asked = iso(NOW - 60_000);
      h.batch(appSessionId, [block(e, asked, 'mu-q', 'Before.\n<need-input>Which backend should the board use?\n<choice recommended>Postgres</choice>\n<choice>SQLite</choice>\n</need-input>')]);
      const anchor = { messageUuid: 'mu-q' as never, blockIndex: 0, span: 0 };
      const head = 'Which backend should the board use?';
      const question = (state: OwnerMark['question']): OwnerMark => ({ id: markIdOf(appSessionId, 'need-input', anchor), kind: 'need-input', anchor, head, at: asked, item: true, question: state });
      const state = (marks: OwnerMark[]): OwnerChannelState => ({ appSessionId, lane: { on: true, override: 'inherit', applied: 'external-compatible-style', pending: null, mismatch: null }, marks });
      h.ownerState(state([question({ state: 'unanswered' })]));
      h.ownerState(state([question({ state: 'queued', text: answerText(head, 'Postgres'), origin: 'answer', members: [] })]));
      const answered = iso(NOW - 30_000);
      const delivered = state([question({ state: 'delivered', answer: { text: answerText(head, 'Postgres'), origin: 'answer', at: answered } })]);
      h.ownerState(delivered);
      h.ownerState(delivered); // the next change of the session states it again
      // a question delivered before this journal heard it asked (no back-fill)
      const earlier = { messageUuid: 'mu-old' as never, blockIndex: 0, span: 0 };
      h.ownerState(state([{ ...question({ state: 'delivered', answer: { text: answerText('Old?', 'Yes'), origin: 'legacy', at: answered } }), id: markIdOf(appSessionId, 'need-input', earlier), anchor: earlier, head: 'Old?' }]));
      const { entries } = h.history({ project: 'proj-1' });
      expect(entries.map(({ kind, text, choices, at }) => ({ kind, text, choices, at }))).toEqual([
        { kind: 'answered', text: 'Postgres', choices: undefined, at: answered },
        { kind: 'question', text: head, choices: ['Postgres', 'SQLite'], at: asked },
      ]);
      expect(entries[0]!.src).toBe(`proj-1/lane-b/${appSessionId}/answer/mu-q/0/q0/${answered}`);
      expect(h.emitted.map((event) => event.entry.kind)).toEqual(['question', 'answered']);
    });

    it('a reply that is no answer line is the answer as written; a question answered again records the new answer beside the first', () => {
      const { appSessionId, engineSessionId: e } = h.session('proj-1');
      h.batch(appSessionId, [block(e, iso(NOW - 60_000), 'mu-q', '<need-input>Ship it?</need-input>')]);
      const anchor = { messageUuid: 'mu-q' as never, blockIndex: 0, span: 0 };
      const delivered = (text: string, at: number): OwnerChannelState => ({
        appSessionId, lane: { on: true, override: 'inherit', applied: null, pending: null, mismatch: null },
        marks: [{ id: markIdOf(appSessionId, 'need-input', anchor), kind: 'need-input', anchor, head: 'Ship it?', at: iso(NOW - 60_000), item: true, question: { state: 'delivered', answer: { text, origin: 'reply', at: iso(at) } } }],
      });
      h.ownerState(delivered('Not yet: the tests are red.', NOW - 20_000));
      h.ownerState(delivered(answerText('Ship it?', 'Yes, now.'), NOW - 10_000));
      expect(h.history({ project: 'proj-1' }).entries.map((entry) => `${entry.kind}: ${entry.text}`)).toEqual(['answered: Yes, now.', 'answered: Not yet: the tests are red.', 'question: Ship it?']);
    });
  });

  describe('the org-project join', () => {
    it('places a session’s entries in its checkout’s sminos project, and records nothing for a session no org project joins', () => {
      const one = h.session('proj-1');
      const two = h.session('proj-2');
      const none = h.session(null);
      for (const [s, word] of [[one, 'one'], [two, 'two'], [none, 'none']] as const) h.batch(s.appSessionId, [block(s.engineSessionId, iso(NOW - 1_000), `mu-${word}`, `<message>${word}</message>`)]);
      h.batch('app-unknown' as AppSessionId, [block('00000000-0000-4000-8000-000000000999' as SessionId, iso(NOW - 1_000), 'mu-x', '<message>a session the index holds no record of</message>')]);
      expect(h.history({ project: 'proj-1' }).entries.map((entry) => entry.text)).toEqual(['one']);
      expect(h.history({ project: 'proj-2' }).entries.map((entry) => entry.text)).toEqual(['two']);
      expect(h.emitted.map((event) => event.project)).toEqual(['proj-1', 'proj-2']);
    });
  });

  describe('lane A, handed in', () => {
    it('records a host message with its project and src, and a resend of the same src records and tells nothing', () => {
      h.channel.record(laneA());
      h.channel.record(laneA({ text: 'The resend.' })); // sminos resends its last 50 on a reconnect
      h.channel.record(laneA({ src: 'proj-a/mini/s1/8', kind: 'question', text: 'Which one?', choices: ['A', 'B'], at: '2026-11-06T13:00:00+02:00' }));
      const { entries } = h.history({ project: 'proj-a' });
      expect(entries.map(({ kind, text, choices, at, lane, appSessionId }) => ({ kind, text, choices, at, lane, appSessionId }))).toEqual([
        { kind: 'message', text: 'From the terminal.', choices: undefined, at: iso(NOW - 60_000), lane: 'A', appSessionId: null },
        { kind: 'question', text: 'Which one?', choices: ['A', 'B'], at: '2026-11-06T11:00:00.000Z', lane: 'A', appSessionId: null }, // 13:00 at +02:00, an hour earlier
      ]);
      expect(h.emitted.map((event) => event.entry.src)).toEqual(['proj-a/mini/s1/7', 'proj-a/mini/s1/8']);
    });

    it('drops an entry that is not one, logging it, and records the next', () => {
      h.channel.record({ ...laneA(), kind: 'note' } as never);
      h.channel.record({ ...laneA(), at: 'yesterday' });
      h.channel.record(laneA({ src: 'proj-a/mini/s1/9' }));
      expect(h.history({ project: 'proj-a' }).entries.map((entry) => entry.src)).toEqual(['proj-a/mini/s1/9']);
    });
  });

  describe('the bounds', () => {
    it('keeps the newest 2,000 entries of each project, whatever another project holds', () => {
      expect(CHANNEL_BOUNDS.perProject).toBe(2_000);
      for (let n = 0; n < 2_005; n++) h.channel.record(laneA({ src: `proj-a/mini/s1/${n}`, at: iso(NOW - 3_000_000 + n * 1_000), text: `m${n}` }));
      h.channel.record(laneA({ project: 'proj-b', src: 'proj-b/mini/s2/1' }));
      const pages: HostEntry[] = [];
      let before: string | undefined;
      for (;;) {
        const page = h.history({ project: 'proj-a', ...(before === undefined ? {} : { before }) });
        pages.push(...page.entries);
        if (!page.more) break;
        before = page.entries.at(-1)!.id;
      }
      expect(pages).toHaveLength(2_000);
      expect(pages[0]!.text).toBe('m2004');
      expect(pages.at(-1)!.text).toBe('m5');
      expect(h.history({ project: 'proj-b' }).entries).toHaveLength(1);
      // an entry older than every one the bound keeps is not kept, and not told
      const told = h.emitted.length;
      h.channel.record(laneA({ src: 'proj-a/mini/s1/old', at: iso(NOW - 3_600_000) }));
      expect(h.emitted).toHaveLength(told);
    });

    it('keeps 30 days: an older entry is never kept, and an entry ages out of history and the table', () => {
      expect(CHANNEL_BOUNDS.maxAgeMs).toBe(30 * DAY);
      h.channel.record(laneA({ src: 'proj-a/mini/s1/stale', at: iso(NOW - 31 * DAY) }));
      h.channel.record(laneA({ src: 'proj-a/mini/s1/aging', at: iso(NOW - 29 * DAY), text: 'aging' }));
      expect(h.history({ project: 'proj-a' }).entries.map((entry) => entry.text)).toEqual(['aging']);
      expect(h.emitted).toHaveLength(1);
      h.tick(2 * DAY);
      expect(h.history({ project: 'proj-a' }).entries).toEqual([]);
      h.channel.record(laneA({ project: 'proj-b', src: 'proj-b/mini/s2/1', at: iso(NOW) }));
      expect(h.rows(), 'the record pruned the aged entry from the table').toBe(1);
    });
  });

  describe('channel.history', () => {
    it('pages newest first by `before` and `limit`, the same time ordered by arrival; a `before` it no longer holds answers none', () => {
      for (let n = 0; n < 5; n++) h.channel.record(laneA({ src: `proj-a/mini/s1/${n}`, at: iso(NOW - (n < 3 ? 10_000 : 20_000)), text: `m${n}` }));
      const first = h.history({ project: 'proj-a', limit: 2 });
      expect(first.entries.map((entry) => entry.text)).toEqual(['m2', 'm1']);
      expect(first.more).toBe(true);
      const second = h.history({ project: 'proj-a', limit: 2, before: first.entries[1]!.id });
      expect(second.entries.map((entry) => entry.text)).toEqual(['m0', 'm4']);
      const last = h.history({ project: 'proj-a', limit: 2, before: second.entries[1]!.id });
      expect(last).toEqual({ entries: [expect.objectContaining({ text: 'm3' })], more: false });
      expect(h.history({ project: 'proj-a', before: '999999' })).toEqual({ entries: [], more: false });
      expect(h.history({ project: 'proj-none' })).toEqual({ entries: [], more: false });
    });
  });
});

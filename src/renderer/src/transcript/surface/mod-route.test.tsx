// @vitest-environment happy-dom
// UX wave U2b, M5 (the execution document, §A "What a window draws", §E, A15): a session MAWS runs where the to-human mod
// draws, over check 1's recordings. The seeded session the probe resumed is read by the file route, every site MAWS
// asks is answered with what the engine answered the probe for the same ask, and the window is read as a person sees it:
// which rows are in sight, which are the mod's drawing, and that MAWS adds no record line, no switch and no message of
// its own. Then the cells where neither draws (every site the engine's slot), the ask tool's call (reported point 21),
// a thought under its bare uuid, the lone call that becomes a run, a reload with no push, and the sequences that hold
// the mod route open: the surface attaching after the mirror drew, going while a record is open, `drawnBy` turning
// `maws` under a live surface, an answer that never comes, a jump while its target's ask is out. Every text is the
// probe's invented text or invented here.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderAnswer } from '@shared/engine/surface';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { status } from '../../../../../test/support/builders';
import { loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { at } from '../../../../../test/support/machine';
import { connectEngineSurface } from '../../engine-surface/site';
import { hookKey, invalidateSession, resetSurfaceRegistry, useSurfaceAnswers } from '../../engine-surface/registry';
import { useAttention } from '../../stores/attention';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { installFakeMain, ok } from '../../test-support/code';
import { journalToEvents } from '../dev/journal';
import { builder } from '../model/test-events';
import type { Row } from '../model/rows';
import type { TranscriptSource } from '../source/types';
import { Transcript } from '../view/Transcript';
import { answerOf, recordedAsks, SEED, SEED_TEXT, seedEvents } from '../../test-support/mod-recordings';
import { accessibleDescription } from '../../test-support/accessible-text'; // ticket 815

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-transcript-scroller')) return 4000;
      if (this.hasAttribute('data-index')) return 40;
      return 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

type Ask = { component: string; instanceId: string; props: Record<string, unknown> };
const SITE_COMMANDS = new Set(['session.ui.render', 'session.ui.renderSite']);
// The engine's slot alone, as the engine answers where no plugin draws instead (u2b-mod-8-*: every row's answer)
const ENGINE = (props: Record<string, unknown>): RenderAnswer => ({ tree: { type: 'engine', ref: 1 }, props, rewritten: true, hooked: true });
const NEVER = Symbol('never');
let main: ReturnType<typeof installFakeMain>;
let reply: (ask: Ask) => RenderAnswer | Promise<RenderAnswer> | typeof NEVER | undefined;
let keys = 0;
let KEY: AppSessionId;

beforeEach(() => {
  resetSurfaceRegistry();
  KEY = at(`App-mod-route-${++keys}` as AppSessionId);
  reply = (ask) => ENGINE(ask.props);
  main = installFakeMain((name, input) => {
    if (!SITE_COMMANDS.has(name)) return ok({ activities: [] });
    const answer = reply(input as unknown as Ask);
    if (answer === NEVER) return new Promise(() => {});
    if (answer instanceof Promise) return answer.then(ok);
    return ok(answer ?? ENGINE((input as unknown as Ask).props));
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  useSessions.setState({ engine: new Map() });
  useAttention.setState({ receipts: new Map() });
  resetSurfaceRegistry();
  delete (window as { maws?: unknown }).maws;
});

const asks = (): Ask[] => main.calls.filter((call) => SITE_COMMANDS.has(call.name)).map((call) => call.input as unknown as Ask);
const asksOf = (instanceId: string) => asks().filter((ask) => ask.instanceId === instanceId);
const attach = (pluginsObservedAt: string | null = null) =>
  useSessions.setState({ engine: new Map([[KEY, { ...status(KEY), uiSurface: { clientId: 'maws-main' }, pluginsObservedAt }]]) });
const detach = () => useSessions.setState({ engine: new Map([[KEY, status(KEY)]]) });

// A source whose snapshot is the given events and whose live batches the test pushes
function sourceOf(events: SessionEvent[]) {
  let listener: ((batch: SessionEvent[]) => void) | null = null;
  const source: TranscriptSource = { key: KEY, subscribe: (l) => { listener = l; return () => (listener = null); }, snapshot: () => Promise.resolve(events) };
  return { source, push: (batch: SessionEvent[]) => act(() => listener?.(batch)) };
}
type Mount = { lane?: boolean; modDraws?: boolean };
async function mount(events: SessionEvent[], { lane = false, modDraws = true }: Mount = {}) {
  const { source, push } = sourceOf(events);
  const element = (m: Mount) => <Transcript source={source} variant="session" ownerLane={m.lane ?? lane} modDraws={m.modDraws ?? modDraws} browserActivity={false} />;
  const view = render(element({}));
  await waitFor(() => expect(useTranscriptStore.getState().entries[KEY]?.phase).toBe('live'));
  return { ...view, push, rerenderWith: (m: Mount) => view.rerender(element(m)) };
}

// What a person sees of an element: its text outside anything hidden (display none, inert, visibility hidden, the
// `hidden` attribute of a tip's description; ticket 815) and what only a screen that cannot point draws (a touch fact)
const hidden = (element: Element) => element instanceof HTMLElement && (element.style.display === 'none' || element.hasAttribute('inert') || element.hasAttribute('hidden') || element.hasAttribute('data-touch-fact') || element.style.visibility === 'hidden');
function inSight(element: Element): string {
  if (hidden(element)) return '';
  let text = '';
  for (const node of element.childNodes) text += node.nodeType === 3 ? node.textContent : node.nodeType === 1 ? inSight(node as Element) : '';
  return text;
}
const rowsOf = () => useTranscriptStore.getState().rows(KEY);
const slotOf = (row: Row) => document.querySelector(`[data-row-id="${CSS.escape(row.id)}"]`);
// Each drawn row by its kind and the text a person sees of it, in order
const sight = () => rowsOf().map((row) => ({ kind: row.kind, id: row.id, text: slotOf(row) ? inSight(slotOf(row)!).trim() : null }));
const rowOfKind = (kind: Row['kind'], nth = 0) => rowsOf().filter((row) => row.kind === kind)[nth]!;
const seen = (row: Row) => inSight(slotOf(row)!).trim();
const recordLines = () => [...document.querySelectorAll('button')].filter((button) => /^› /.test(button.textContent ?? '') && !hidden(button));

describe('where the mod draws, over the seeded session the probe resumed (u2b-mod-rows)', () => {
  const rows9 = recordedAsks('u2b-mod-rows');

  it('the report: the mod’s messages and record line in sight, the work it folds hidden, and nothing of MAWS’s own view', async () => {
    attach();
    reply = (ask) => answerOf(rows9, ['seed rows', 'folded'], ask);
    await mount(await seedEvents());
    await waitFor(() => expect(seen(rowOfKind('to_human'))).toContain(SEED_TEXT.sent));
    expect(document.querySelector('.owner-record-fold')).toBeNull(); // no record line of MAWS's
    expect(document.querySelector('[data-view-switch]')).toBeNull(); // no switch of MAWS's
    expect(useTranscriptStore.getState().entries[KEY]!.state.ui.noTurnFold).toBe(true); // the lane off, the mod drawing: no turn folds
    for (const kind of ['group', 'agent_list', 'notice', 'divider'] as const) expect(seen(rowOfKind(kind)), kind).toBe('');
    expect(seen(rowsOf().find((row) => row.kind === 'assistant_text' && row.messageUuid === SEED.a5)!)).toBe(''); // the unmarked text
    expect(seen(rowOfKind('user'))).toContain(SEED_TEXT.prompt);
    expect(accessibleDescription(slotOf(rowOfKind('question'))!.querySelector('[data-question-label]')!)).toBe(SEED_TEXT.question);
    const mixed = rowsOf().find((row) => row.kind === 'assistant_text' && row.messageUuid === SEED.a7)!;
    expect(seen(mixed)).toContain('› working record'); // the mod's record line, in its own drawing
    expect(slotOf(mixed)!.querySelector('[data-plugin-drawn]')).not.toBeNull();
    expect(recordLines().every((line) => line.closest('[data-plugin-drawn]') !== null)).toBe(true);
    expect(seen(rowsOf().find((row) => row.kind === 'assistant_text' && row.messageUuid === SEED.a9)!)).toContain('All three notes are sorted');
  });

  it('the full transcript: every row in sight, the message call the mod’s message; MAWS asked as the probe did', async () => {
    attach();
    reply = (ask) => answerOf(rows9, ['full transcript'], ask);
    await mount(await seedEvents());
    await waitFor(() => expect(seen(rowOfKind('group'))).not.toBe(''));
    for (const row of sight()) expect(row.text, `${row.kind} ${row.id}`).not.toBe('');
    expect(recordLines()).toHaveLength(0);
    // each ask the probe also sent, under the same site and instance, is one the probe sent with these props (the
    // adapters built both); `isExpanded` aside, a line's open state being the reader's, which the probe set as it chose.
    // The delivery's text the probe sent under three origins (C5), each answered alike; MAWS's file route reads it as
    // `unclassified`, one of them
    // A turn's line carries the turn's measured time, which the probe invented (42 s for the seed's first turn)
    const shape = (props: Record<string, unknown>) => JSON.stringify({ ...props, isExpanded: undefined, durationMs: undefined });
    const probe = new Map<string, Set<string>>();
    for (const ask of rows9) probe.set(`${ask.component} ${ask.instanceId}`, (probe.get(`${ask.component} ${ask.instanceId}`) ?? new Set()).add(shape(ask.props)));
    const matched = asks().filter((ask) => probe.has(`${ask.component} ${ask.instanceId}`));
    expect(new Set(matched.map((ask) => ask.instanceId)).size).toBeGreaterThanOrEqual(10);
    for (const ask of matched) expect(probe.get(`${ask.component} ${ask.instanceId}`)!.has(shape(ask.props)), `${ask.component} ${ask.instanceId} ${shape(ask.props)}`).toBe(true);
  });

  // Reported point 21: the ask tool's call is the AskUserQuestion site's, under the call's id, and never a ToolUse ask
  it('a question of the sminos ask tool asks AskUserQuestion under its call’s id, no ToolUse, and draws MAWS’s QuestionRow (no receipt staged)', async () => {
    attach();
    reply = (ask) => answerOf(rows9, ['seed rows'], ask);
    await mount(await seedEvents());
    await waitFor(() => expect(asksOf(SEED.t5).length).toBeGreaterThan(0));
    expect(asksOf(SEED.t5).map((ask) => ask.component)).toEqual(['AskUserQuestion']);
    const question = slotOf(rowOfKind('question'))!;
    expect(accessibleDescription(question.querySelector('[data-question-label]')!)).toBe(SEED_TEXT.question); // MAWS's QuestionRow
    expect(inSight(question)).toMatch(/^Archive→/);
    expect(question.querySelector('[data-plugin-drawn]')).toBeNull();
  });
});

// Reported point 21 with R13: the question's row carries its receipt, so its answer's notice, a delivery the mod folds
// (check 1's C5: a `UserMessage` of origin `plugin` anchored after the question heads a record line of its own), is no
// second statement of the answer; the row is the one statement, outside the folded record
describe('the ask tool’s question with its receipt (point 21, R13)', () => {
  const rows9 = recordedAsks('u2b-mod-rows');
  const QUESTION = 'Which archive should the notes go to?';
  it('asks AskUserQuestion under its call’s id and no ToolUse; MAWS’s QuestionRow draws the receipt; the answer is stated once, outside the folded record', async () => {
    const b = builder();
    b.turn('u1', 'Sort the notes');
    b.text('m0', 0, '<message>Sorting.</message>');
    b.toolUse('q5', 'mcp__sminos__AskUserQuestion', { questions: [{ question: QUESTION, header: 'Archive', multiSelect: false, options: [{ label: 'Old', description: 'The old archive' }, { label: 'New', description: 'A new archive' }] }], async: true });
    b.result('q5', 'Your questions are waiting for the human; this call does not wait for them. Their answer will reach you in a later message that quotes each question. Go on with work that does not depend on it.');
    const summary = `Your questions have been answered: "${QUESTION}"="Old".`;
    b.emit('user.message', { messageUuid: 'd1' as never, content: summary, isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [{ class: 'answer', tool: 'sminos', call: 'q5', summary, answers: null, dismissed: false }] });
    b.toolUse('t2', 'Bash', { command: 'mv notes archive/old' });
    b.result('t2', 'ok');
    b.text('m1', 0, '<message>Moved to the old archive.</message>');
    b.end(['u1']);
    attach();
    // the receipt, where QuestionRow reads it (the attention store's, as the card's follower writes it)
    useAttention.setState((s) => ({ receipts: new Map([...s.receipts, [KEY, new Map([['q5' as ToolUseId, { answers: { [QUESTION]: 'Old' } }]])]]) }));
    const folded = rows9.find((ask) => ask.label.startsWith('folded: C5 answer notice'))!.answer; // the mod's answer to the notice
    reply = (ask) => (ask.component === 'UserMessage' && (ask.props.origin as { kind?: string } | undefined)?.kind === 'plugin' ? { ...folded, props: ask.props } : ENGINE(ask.props));
    await mount(b.events);
    const question = rowsOf().find((row): row is Extract<Row, { kind: 'question' }> => row.kind === 'question')!;
    const notice = rowsOf().find((row): row is Extract<Row, { kind: 'notice' }> => row.kind === 'notice' && row.class === 'answer')!;
    expect(notice).toBeDefined();
    await waitFor(() => expect(asksOf(question.toolUseId).length).toBeGreaterThan(0));
    expect(asksOf(question.toolUseId).map((ask) => ask.component)).toEqual(['AskUserQuestion']);
    expect(asks().some((ask) => ask.component === 'ToolUse' && ask.instanceId === question.toolUseId)).toBe(false);
    const drawn = slotOf(question)!;
    expect(accessibleDescription(drawn.querySelector('[data-question-label]')!)).toBe(QUESTION);
    expect(drawn.querySelector('[data-answer]')!.textContent).toBe('Old'); // the receipt, drawn
    expect(drawn.querySelector('[data-answer="none"]')).toBeNull();
    // the notice asked as the delivery the mod folds, and folded: it heads a record line, the answer nowhere in it
    await waitFor(() => expect(seen(notice)).toBe('› working record'));
    expect(asks().find((ask) => ask.instanceId.endsWith(`~${notice.id}`))!.props.origin).toEqual({ kind: 'plugin', name: 'sminos' });
    // the answer stated once in sight, by the question's row
    expect(sight().filter((row) => row.text !== null && /\bOld\b/.test(row.text)).map((row) => row.kind)).toEqual(['question']);
  });
});

describe('where neither draws: every site answers the engine’s slot (u2b-mod-8-*)', () => {
  it.each(['u2b-mod-8-before', 'u2b-mod-8-after'])('%s: every row in sight, each message a message, no record line, no blank row, the action rows standing', async (name) => {
    const recorded = recordedAsks(name);
    attach();
    reply = (ask) => answerOf(recorded, ['pass 2'], ask); // an ask the probe did not send: the engine's slot
    await mount(await seedEvents());
    await waitFor(() => expect(document.querySelector('[data-to-human-call] .owner-message-ink')).not.toBeNull());
    for (const row of sight()) expect(row.text, `${row.kind} ${row.id}`).not.toBe('');
    expect(recordLines()).toHaveLength(0);
    expect(document.querySelector('.owner-record-fold')).toBeNull();
    expect(document.querySelector('[data-view-switch]')).toBeNull();
    expect(document.querySelectorAll('.owner-message-ink').length).toBeGreaterThanOrEqual(3); // the call's, the mixed text's, the final's
    expect(document.querySelector('[data-plugin-drawn]')).toBeNull();
    expect(document.querySelector('.transcript-answer-actions')).not.toBeNull();
  });

  it('a row whose answer never comes shows its placeholder as today, and nothing else waits on it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    attach();
    // the session's ToolUse hook is known (another view of it drew one), so a row whose ask is out is withheld as today
    useSurfaceAnswers.setState({ hooked: new Map([[hookKey(KEY, 'ToolUse'), true]]) });
    reply = (ask) => (ask.instanceId === SEED.t6 ? NEVER : ENGINE(ask.props));
    await mount(await seedEvents());
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    const listing = slotOf(rowOfKind('agent_list'))!;
    expect(listing.querySelector('[data-engine-withheld]')?.textContent).toBe('…');
    for (const row of sight().filter((r) => r.kind !== 'agent_list')) expect(row.text, `${row.kind} ${row.id}`).not.toBe('');
  });
});

describe('the rows the probe asked one by one', () => {
  // C2: a thought asked under its row's bare uuid takes its place at its message; E2: a write the drawn line read pushes
  // an invalidation, and the re-asked line reads the new label
  it('a thought outside a run asks AssistantMessage under its bare uuid, and draws the mod’s line and then its new label', async () => {
    const label = recordedAsks('u2b-mod-label');
    const b = builder();
    b.turn('u1', 'Sort the notes');
    b.thinking('m1', 0, SEED_TEXT.thought);
    b.text('m1', 1, '<message>Sorted.</message>');
    b.end(['u1']);
    attach();
    let step = 'the thought alone';
    reply = (ask) => (ask.component === 'AssistantMessage' && ask.props.isSummary === true ? { ...label.find((a) => a.label === step)!.answer, props: ask.props } : ENGINE(ask.props));
    await mount(b.events);
    const thought = rowOfKind('thinking');
    expect(thought.kind === 'thinking' && thought.messageUuid).toBeTruthy();
    await waitFor(() => expect(seen(thought)).toBe('› working record'));
    const asked = asks().filter((ask) => ask.props.isSummary === true);
    expect(asked.map((ask) => [ask.component, ask.instanceId, ask.props])).toEqual([['AssistantMessage', (thought as Extract<Row, { kind: 'thinking' }>).messageUuid, { text: SEED_TEXT.thought, isFirstOfReply: false, isSummary: true }]]);
    step = 'the thought again';
    act(() => invalidateSession(KEY));
    await waitFor(() => expect(seen(thought)).toBe('› Listed the three notes and sorted the first one'));
  });

  // E3 (u2b-mod-mock-grow-9-after-fix): while a stretch grows, its head reads the newest call. MAWS draws a live run of
  // one as a run's row already (U2's run of one), so it asks `ToolGroup` under `group:<first call>` from the first call
  // on, the pattern check 1 found keeps the line (E3's `-group`); each step is answered with what the head the probe
  // asked answered then (its lone `ToolUse` first, the group once the second call came)
  it('the lone call that becomes a run: one line at every step, on the run', async () => {
    const name = 'u2b-mod-mock-grow-9-after-fix';
    const journal = loadUxwaveJournal(name);
    const heads = recordedAsks(name).filter((r) => r.label.startsWith('growing') || r.label.startsWith('after the turn'));
    let cut = 0;
    reply = (ask) => {
      const head = heads.filter((r) => r.seq <= cut && `group:${r.instanceId.replace(/^group:/, '')}` === ask.instanceId).at(-1);
      return ask.component === 'ToolGroup' && head ? { ...head.answer, props: ask.props } : ENGINE(ask.props);
    };
    const upTo = (seq: number) => journalToEvents(journal.filter((row) => row.seq < seq));
    const labelOf = (answer: RenderAnswer) => JSON.stringify(answer.tree).match(/› [^"]+/)![0];
    attach();
    cut = heads[0]!.seq;
    const view = await mount(upTo(cut));
    let sent = upTo(cut).length;
    for (const head of heads) {
      cut = head.seq;
      const events = upTo(cut);
      await view.push(events.slice(sent));
      sent = events.length;
      act(() => invalidateSession(KEY)); // the mod's push for the write its drawn line read (E2)
      await waitFor(() => expect(recordLines().map((line) => line.textContent), `at ${head.seq}`).toEqual([labelOf(head.answer)]));
      expect(recordLines()[0]!.closest('[data-row-id]')!.getAttribute('data-row-id')).toMatch(/^group:/);
    }
    expect(new Set(heads.map((head) => labelOf(head.answer)))).toEqual(new Set(['› Grow step 0', '› Grow step 1', '› Grow step 2', '› Ran grow step 0 (mock summary 1)']));
    expect(asks().some((ask) => ask.component === 'ToolUse' && ask.instanceId === heads[0]!.instanceId)).toBe(false);
  });

  // C4: reload_plugins may push no invalidation; the status's `pluginsObservedAt` alone re-asks the mounted rows
  it('a reload with no push: a status whose plugins were observed anew re-asks every mounted row', async () => {
    const lone = recordedAsks('u2b-mod-lone-thought');
    const b = builder();
    b.turn('u1', 'Sort the notes');
    b.thinking('m1', 0, SEED_TEXT.thought);
    b.text('m1', 1, '<message>Sorted.</message>');
    b.end(['u1']);
    const off = connectEngineSurface(main.bridge as unknown as MawsBridge); // the page's bridge, as the connection hears main
    attach('2026-11-16T10:00:00.000Z');
    act(() => main.emit('session.status', { appSessionId: KEY, status: useSessions.getState().engine.get(KEY)! }));
    let step = 'alone, first ask';
    reply = (ask) => (ask.props.isSummary === true ? { ...lone.find((a) => a.label === step)!.answer, props: ask.props } : ENGINE(ask.props));
    await mount(b.events);
    const thought = rowOfKind('thinking');
    await waitFor(() => expect(seen(thought)).toBe('› working record'));
    const before = asks().length;
    step = 'alone, in the full transcript';
    act(() => main.emit('session.status', { appSessionId: KEY, status: useSessions.getState().engine.get(KEY)! })); // the same report: nothing
    expect(asks().length).toBe(before);
    attach('2026-11-16T10:05:00.000Z');
    act(() => main.emit('session.status', { appSessionId: KEY, status: useSessions.getState().engine.get(KEY)! }));
    await waitFor(() => expect(seen(thought)).toBe('Thought')); // the engine's drawing: MAWS's own thought, folded
    expect(slotOf(thought)!.querySelector('[data-plugin-drawn]')).toBeNull();
    expect(asks().length).toBeGreaterThan(before);
    expect(new Set(asks().slice(before).map((ask) => ask.instanceId)).size).toBe(new Set(asks().slice(0, before).map((ask) => ask.instanceId)).size);
    off();
  });
});

describe('the sequences that hold the mod route open', () => {
  const rows9 = recordedAsks('u2b-mod-rows');
  const marked = () => {
    const b = builder();
    b.turn('u1', 'Tidy the notes');
    b.toolUse('t1', 'Bash', { command: 'ls notes' });
    b.result('t1', 'notes.md');
    b.text('m1', 0, '<message>The notes are tidy.</message>');
    b.end(['u1']);
    b.turn('u2', 'And the rest');
    b.toolUse('t2', 'Bash', { command: 'ls rest' });
    b.result('t2', 'rest.md');
    b.text('m2', 0, '<message>The rest are tidy too.</message>');
    b.end(['u2']);
    return b.events;
  };
  const folds = () => document.querySelectorAll('.owner-record-fold');

  it('the surface attaches after the mirror drew: the mirror goes in one update with the first asks', async () => {
    const view = await mount(marked(), { lane: true, modDraws: false });
    await waitFor(() => expect(folds().length).toBe(2)); // the mirror's record lines, no surface yet
    expect(asks()).toHaveLength(0);
    act(() => {
      attach();
      view.rerenderWith({ modDraws: true });
    });
    expect(folds()).toHaveLength(0);
    expect(asks().length).toBeGreaterThan(0);
  });

  it('the surface goes while a record is open in the mod’s view: the mirror draws, every stretch closed', async () => {
    const view = await mount(marked(), { lane: true, modDraws: false });
    await waitFor(() => expect(folds().length).toBe(2));
    fireEvent.click(folds()[0]!.querySelector('button')!);
    await waitFor(() => expect(document.querySelectorAll('.owner-record-fold[data-open]').length).toBeGreaterThan(0)); // the mirror's stretch open
    act(() => { attach(); view.rerenderWith({ modDraws: true }); });
    expect(folds()).toHaveLength(0);
    act(() => { detach(); view.rerenderWith({ modDraws: false }); });
    await waitFor(() => expect(folds().length).toBe(2));
    expect(document.querySelectorAll('.owner-record-fold[data-open]')).toHaveLength(0);
  });

  it('drawnBy turns maws under a live surface: the mirror draws while the asks go on, answered with the engine’s drawing', async () => {
    attach();
    reply = (ask) => answerOf(rows9, ['full transcript'], ask) ?? ENGINE(ask.props);
    const view = await mount(marked(), { lane: true, modDraws: true });
    await waitFor(() => expect(asks().length).toBeGreaterThan(0));
    expect(folds()).toHaveLength(0);
    reply = (ask) => ENGINE(ask.props); // a reload to an installation without the declaration
    act(() => view.rerenderWith({ modDraws: false }));
    await waitFor(() => expect(folds().length).toBe(2));
    const before = asks().length;
    act(() => invalidateSession(KEY));
    await waitFor(() => expect(asks().length).toBeGreaterThan(before)); // the asks go on
    expect(document.querySelector('[data-plugin-drawn]')).toBeNull();
  });

  it('a jump lands while its target’s ask is out: the target is revealed and draws MAWS’s own; the late answer is dropped', async () => {
    attach();
    const TARGET = '<message>The notes are tidy.</message>';
    const EMPTY = (props: Record<string, unknown>): RenderAnswer => ({ tree: { type: 'Box', children: [] }, props, rewritten: false, hooked: true });
    let release: (() => void) | null = null;
    reply = (ask) => {
      if (ask.component !== 'AssistantMessage' || ask.props.text !== TARGET || release !== null) return EMPTY(ask.props);
      return new Promise<RenderAnswer>((resolve) => { release = () => resolve(EMPTY(ask.props)); });
    };
    await mount(marked());
    const target = rowsOf().find((row) => row.kind === 'assistant_text' && row.markdown === TARGET)!;
    await waitFor(() => expect(release).not.toBeNull());
    act(() => useTranscriptStore.getState().jumpTo(KEY, target.id));
    expect(useTranscriptStore.getState().entries[KEY]!.state.ui.revealed).toBe(target.id);
    await waitFor(() => expect(seen(rowsOf().find((row) => row.id === target.id)!)).toContain('The notes are tidy.'));
    await act(async () => release!()); // the answer to the ask made before the jump: it would hide the row
    expect(seen(rowsOf().find((row) => row.id === target.id)!)).toContain('The notes are tidy.');
    expect(document.querySelector(`[data-row-id="${CSS.escape(target.id)}"] [data-plugin-drawn]`)).toBeNull();
  });
});

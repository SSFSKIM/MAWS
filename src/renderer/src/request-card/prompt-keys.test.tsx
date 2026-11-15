// UX wave U1b M4 (the U1b document, Interfaces §F; acceptance 2): a permission prompt's three chords, ⌘↩, ⇧⌘↩ and Esc, at
// a transcript's end, through the real dispatcher with the session's real composer and transcript mounted in one pane.
// They answer the open prompt from the session's composer, from the prompt's own row and from nothing with the pane
// active, ahead of the composer's own keys, once the guard is armed; from nowhere else. A press the prompt takes inside
// its grace answers nothing and does not fall through to the composer. The test drives the clock (performance's) and the
// prompt's geometry; every command, question and id is invented.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { PreloadBridge } from '@shared/ipc/schema';
import { REGISTRY } from '@shared/ipc/registry';
import { addressingOf, bareOf } from '@shared/machine/address';
import { humanTurn, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { Composer } from '../composer/Composer';
import { resetDictationStore, useDictationStore } from '../composer/dictation/store';
import { registerSlashWidget } from '../composer/mentions/widgets';
import { resetTakeBack } from '../composer/queue/take-back';
import { resetSurfaceRegistry } from '../engine-surface/registry';
import { connectKeys } from '../keymap/dispatcher';
import { resetLaneAStore } from '../stores/lane-a';
import { useAttention } from '../stores/attention';
import { resetComposerStore } from '../stores/composer';
import { useHosts } from '../stores/hosts';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { hostStatus } from '../test-support/host-status';
import { preloadOf } from '../test-support/preload-of';
import { layOutPrompts } from '../test-support/prompt-layout';
import { resetShellStores } from '../test-support/shell-stores';
import { Transcript, TranscriptSlot, useTranscriptStore } from '../transcript';
import { builder, request, tool } from '../transcript/model/test-events';
import { connectRequestCard, renderSessionRequest } from './index';
import { itemFor, type RequestEvent } from './test-requests';

const APP = at('app-keys' as AppSessionId);
const addressing = addressingOf(REGISTRY);
const GRACE = 400;
const QUESTIONS = [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: null, preview: null }, { label: 'Blue', description: null, preview: null }] }];
const permissionOf = (requestId: string, toolUseId: string, command: string) => ({
  requestId: request(requestId), toolUseId: tool(toolUseId), toolName: 'Bash', displayName: 'Bash', input: { command }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null,
});
const CMD_ENTER = { key: 'Enter', code: 'Enter', metaKey: true };
const SHIFT_CMD_ENTER = { key: 'Enter', code: 'Enter', metaKey: true, shiftKey: true };
const ESCAPE = { key: 'Escape', code: 'Escape' };
const ALLOW_ONCE = { kind: 'permission', decision: 'allow', scope: 'once' };
const DENY = { kind: 'permission', decision: 'deny' };

// ---- the page's layout ------------------------------------------------------------------------------------------------
// happy-dom has no layout: a viewport for the scroller and a height per row, so the virtualiser mounts every row; and the
// open prompt laid out in the window (`layOutPrompts`), or scrolled away from it
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 4000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));
let layout: ReturnType<typeof layOutPrompts>;
// the prompt moved by a scroll, and the guard told (the scroll, then its next frame)
async function scrollPrompt(by: number) {
  layout.shift(by);
  window.dispatchEvent(new Event('scroll'));
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

// ---- the session and its pane -----------------------------------------------------------------------------------------
let fake: FakeClient;
let events: SessionEvent[] = [];
let requests = new Map<string, SessionEvent>();
let outcome: 'delivered' | 'write_failed' = 'delivered';
let offs: (() => void)[] = [];
let queryClient: QueryClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] });
  vi.advanceTimersByTime(10_000);
  resetShellStores();
  resetComposerStore();
  resetQueueStore();
  resetLaneAStore();
  resetSurfaceRegistry();
  resetDictationStore();
  useNotices.setState({ notices: [] });
  useHosts.setState({ supervisor: hostStatus() });
  useAttention.setState({ receipts: new Map(), settling: new Map() });
  events = [];
  requests = new Map();
  outcome = 'delivered';
  fake = fakeClient({
    'session.events': () => ({ events, lastSeq: events.length, complete: true }),
    'attention.request': (input: { requestId: string }) => ({ event: requests.get(input.requestId) ?? null }),
    'session.answer': () => ({ outcome }),
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.drafts.get': null,
    'session.drafts.set': undefined,
    'session.history.append': undefined,
    'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q-1' },
    'session.interrupt': { stillQueued: [], cancelled: [] },
    'session.listModels': { models: [] },
    'session.listPermissionRules': { state: { rules: [], workspaceDirectories: [], originalCwd: '/work/app-keys', managedOnly: false } },
    'engine.models': { models: [], source: 'cached', at: '2026-09-29T09:00:00.000Z' },
  });
  window.maws = preloadOf(fake);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  layout = layOutPrompts();
  offs = [connectKeys(), connectRequestCard()];
});
afterEach(() => {
  offs.forEach((off) => off());
  cleanup();
  resetTakeBack();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: PreloadBridge }).maws;
  layout.restore();
  vi.useRealTimers();
});

// A running turn that asks a question and runs two shell calls that wait for permission, each request event pending.
function scene() {
  const b = builder();
  b.turn('u1', 'Set things up');
  b.text('m0', 0, 'Two things first.');
  b.toolUse('q1', 'AskUserQuestion', { questions: QUESTIONS });
  const asked = b.emit('question.requested', { requestId: request('rq'), toolUseId: tool('q1'), questions: QUESTIONS });
  b.toolUse('b1', 'Bash', { command: 'make check' }, 'm2', 0);
  const prompt = b.emit('permission.requested', permissionOf('rp', 'b1', 'make check'));
  b.toolUse('b2', 'Bash', { command: 'make lint' }, 'm2', 1);
  const second = b.emit('permission.requested', permissionOf('rp2', 'b2', 'make lint'));
  events = b.events;
  for (const event of [asked, prompt, second]) requests.set(event.requestId, event);
  return {
    question: itemFor(asked as RequestEvent, APP, { summary: 'Which colour?' }),
    prompt: itemFor(prompt as RequestEvent, APP, { summary: 'Bash: make check' }),
    second: itemFor(second as RequestEvent, APP, { summary: 'Bash: make lint' }),
  };
}

function busy() {
  const s = useSessions.getState();
  const page = addressing.output('session.get').lift(record(bareOf(APP)), TEST_MACHINE)! as SessionRecord;
  const engine = addressing.output('engine.sessions').lift([status(bareOf(APP), { engineState: 'running', turn: humanTurn })], TEST_MACHINE)[0]! as EngineSessionStatus;
  useSessions.setState({ records: new Map(s.records).set(APP, page), engine: new Map(s.engine).set(APP, engine), recordsVersion: s.recordsVersion + 1 });
  useLayout.setState((l) => ({ main: { ...l.main, panes: [{ tabs: [{ id: `session:${APP}`, kind: 'session', appSessionId: APP, pinned: false }], activeTabId: `session:${APP}` }], focusedPane: 0, splitRatio: 0.5 } }) as never);
}

// Pane 0 shows the session: its transcript and its composer (and, for one case, a child transcript beside them); pane 1
// holds a text field of its own.
async function mount(items: AttentionItem[], extra: ReactNode = null) {
  busy();
  act(() => useAttention.getState().applySnapshot(items, TEST_MACHINE));
  render(
    <QueryClientProvider client={queryClient}>
      <section data-pane={0} aria-label="pane 0">
        <TranscriptSlot appSessionId={APP} />
        {extra}
        <input type="search" aria-label="filter" />
        <Composer appSessionId={APP} paneIndex={0} />
      </section>
      <section data-pane={1} aria-label="pane 1">
        <input aria-label="other pane's field" />
      </section>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(end() && within(end()!).queryByRole('button', { name: 'Allow once' })).not.toBeNull());
  await waitFor(() => expect(editor()).toBeTruthy());
}

type TiptapElement = HTMLElement & { editor: { commands: { insertContent(text: string): boolean }; getText(): string } };
const pane = (index: 0 | 1) => screen.getByRole('region', { name: `pane ${index}` });
const editor = () => within(pane(0)).queryByRole('textbox', { name: 'Message', hidden: true }) as TiptapElement | null;
const end = () => document.querySelector<HTMLElement>('[data-request-end]');
const endRow = () => end()!.closest<HTMLElement>('.transcript-row')!;
const questionRow = () => document.querySelector<HTMLElement>('.transcript-row[data-kind="question"]')!;
const openPrompt = () => within(end()!).getByRole('group', { name: 'Approval needed' });
const answered = () => (fake.invoked('session.answer') as { requestId: string; answer: unknown }[]).map(({ requestId, answer }) => ({ requestId, answer }));
const sent = () => fake.invoked('session.send');
const focusOn = (element: HTMLElement) => act(() => element.focus());
const focusNothing = () => act(() => (document.activeElement as HTMLElement | null)?.blur());
const arm = () => act(() => void vi.advanceTimersByTime(GRACE));
const type = (text: string) => act(() => void editor()!.editor.commands.insertContent(text));
const flush = () => act(async () => {});
async function press(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => void target.dispatchEvent(event));
  return event;
}
const pressAll = async (target: Element) => {
  for (const chord of [CMD_ENTER, SHIFT_CMD_ENTER, ESCAPE]) await press(target, chord);
  await flush();
};
const none = (requestId: string) => answered().filter((a) => a.requestId === requestId);

describe('a prompt’s keys reach it', () => {
  const CHORDS = [
    ['⌘↩', CMD_ENTER, ALLOW_ONCE],
    ['⇧⌘↩', SHIFT_CMD_ENTER, { kind: 'permission', decision: 'allow', scope: 'session' }],
    ['Esc', ESCAPE, DENY],
  ] as const;
  it.each((['composer', 'row', 'body'] as const).flatMap((where) => CHORDS.map(([name, chord, answer]) => [name, where, chord, answer] as const)))(
    '%s answers the open prompt from %s (the session’s composer, its own row, nothing with its pane active)',
    async (_name, where, chord, answer) => {
      const { prompt } = scene();
      await mount([prompt]);
      arm();
      const target = where === 'composer' ? editor()! : where === 'row' ? endRow() : document.body;
      if (where === 'body') focusNothing();
      else focusOn(target);
      expect((await press(target, chord)).defaultPrevented).toBe(true);
      await waitFor(() => expect(answered()).toEqual([{ requestId: 'rp', answer }]));
    },
  );

  it('⌘↩ with a draft is the composer’s: it queues the message and the prompt stays', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    focusOn(editor()!);
    await type('after the turn');
    await press(editor()!, CMD_ENTER);
    await waitFor(() => expect(sent()).toEqual([{ appSessionId: bareOf(APP), content: 'after the turn' }]));
    expect(answered()).toEqual([]);
    expect(openPrompt()).toBeTruthy();
  });

  it('Esc with the composer’s popup open closes the popup and answers nothing', async () => {
    const off = registerSlashWidget('usage', { title: 'Usage', component: () => null }); // a row for the `/` list
    onTestFinished(off);
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    focusOn(editor()!);
    await type('/');
    await waitFor(() => expect(document.querySelector('[data-key-sink="composer"] [role="listbox"]')).not.toBeNull());
    await press(editor()!, ESCAPE);
    await waitFor(() => expect(document.querySelector('[data-key-sink="composer"] [role="listbox"]')).toBeNull());
    expect(answered()).toEqual([]);
  });

  it('a press inside the grace is taken and answers nothing: no Stop, no queue', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    act(() => void vi.advanceTimersByTime(GRACE - 1));
    focusOn(editor()!);
    expect((await press(editor()!, ESCAPE)).defaultPrevented).toBe(true);
    expect((await press(editor()!, CMD_ENTER)).defaultPrevented).toBe(true);
    await flush();
    expect(answered()).toEqual([]);
    expect(fake.invoked('session.interrupt')).toEqual([]);
    expect(sent()).toEqual([]);
    act(() => void vi.advanceTimersByTime(1));
    await press(editor()!, CMD_ENTER);
    await waitFor(() => expect(answered()).toEqual([{ requestId: 'rp', answer: ALLOW_ONCE }]));
  });

  it('a held chord answers one prompt of two: its repeats are taken while the second opens, and a fresh press answers the second once armed', async () => {
    const { prompt, second } = scene();
    await mount([prompt, second]);
    arm();
    focusOn(editor()!);
    await press(editor()!, CMD_ENTER);
    await waitFor(() => expect(answered()).toEqual([{ requestId: 'rp', answer: ALLOW_ONCE }]));
    act(() => useAttention.getState().applySnapshot([second], TEST_MACHINE)); // the answered one leaves; the second opens
    await waitFor(() => expect(openPrompt().textContent).toContain('make lint'));
    for (let i = 0; i < 12; i++) {
      act(() => void vi.advanceTimersByTime(50));
      expect((await press(editor()!, { ...CMD_ENTER, repeat: true })).defaultPrevented).toBe(true);
    }
    await flush();
    expect(answered()).toHaveLength(1);
    expect(sent()).toEqual([]);
    await press(editor()!, CMD_ENTER);
    await waitFor(() => expect(answered()).toEqual([{ requestId: 'rp', answer: ALLOW_ONCE }, { requestId: 'rp2', answer: ALLOW_ONCE }]));
  });

  it('a prompt that becomes live again after a failed write re-arms', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    focusOn(endRow());
    outcome = 'write_failed';
    await press(endRow(), CMD_ENTER);
    await waitFor(() => expect(within(end()!).queryByText("Couldn't deliver the answer")).not.toBeNull());
    outcome = 'delivered';
    await press(endRow(), CMD_ENTER);
    await flush();
    expect(answered()).toHaveLength(1); // live again a moment ago: inside its grace
    arm();
    await press(endRow(), CMD_ENTER);
    await waitFor(() => expect(answered()).toHaveLength(2));
  });
});

// The three refusals of focus (§F, "Whose focus"), each leaving the key to the next binding: from these the chords
// answer nothing of the prompt; from the composer, a moment later, the same chord answers it.
describe('a prompt’s keys do not reach it', () => {
  it('from the keyboard on another request’s row (a question waiting in its row)', async () => {
    const { question, prompt } = scene();
    await mount([question, prompt]);
    await waitFor(() => expect(within(questionRow()).queryByRole('radio', { name: 'Red' })).not.toBeNull());
    arm();
    focusOn(questionRow());
    await pressAll(questionRow());
    expect(none('rp')).toEqual([]);
    focusOn(editor()!);
    await press(editor()!, CMD_ENTER);
    await waitFor(() => expect(none('rp')).toEqual([{ requestId: 'rp', answer: ALLOW_ONCE }]));
  });

  it('from the keyboard on any other transcript row', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    const other = [...document.querySelectorAll<HTMLElement>('.transcript-row')].find((row) => row !== endRow() && !end()!.contains(row))!;
    focusOn(other);
    await pressAll(other);
    expect(answered()).toEqual([]);
    focusOn(editor()!);
    await press(editor()!, ESCAPE);
    await waitFor(() => expect(answered()).toEqual([{ requestId: 'rp', answer: DENY }]));
  });

  it('from inside a child transcript drawn in the same pane', async () => {
    const { prompt } = scene();
    const c = builder();
    c.turn('c1', 'Survey the folder');
    c.text('cm0', 0, 'Looking.');
    const source = { subscribe: () => () => {}, snapshot: () => Promise.resolve(c.events) }; // a subagent's rows
    await mount(
      [prompt],
      <div data-testid="child">
        <Transcript source={source} variant="child" renderRequest={renderSessionRequest} />
      </div>,
    );
    await waitFor(() => expect(screen.getByTestId('child').querySelector('.transcript-row')).not.toBeNull());
    arm();
    const childRow = screen.getByTestId('child').querySelector<HTMLElement>('.transcript-row')!;
    focusOn(childRow);
    await pressAll(childRow);
    expect(answered()).toEqual([]);
    focusOn(editor()!);
    await press(editor()!, CMD_ENTER);
    await waitFor(() => expect(answered()).toEqual([{ requestId: 'rp', answer: ALLOW_ONCE }]));
  });
});

describe('the refusals that stand', () => {
  it('an input method composing in the composer', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    focusOn(editor()!);
    for (const chord of [CMD_ENTER, SHIFT_CMD_ENTER, ESCAPE]) await press(editor()!, { ...chord, isComposing: true });
    await flush();
    expect(answered()).toEqual([]);
  });

  it('another text field in the pane', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    const field = within(pane(0)).getByRole('searchbox', { name: 'filter' });
    focusOn(field);
    await pressAll(field);
    expect(answered()).toEqual([]);
  });

  it('dictation live in that composer', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    act(() => useDictationStore.setState({ capture: { appSessionId: APP, captureId: 'capture-1', phase: 'listening', locale: null, interim: '' } }));
    focusOn(editor()!);
    await pressAll(editor()!);
    expect(answered()).toEqual([]);
  });

  it('another pane holding the keyboard, with nothing focused', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    const holding = (focusedPane: 0 | 1) => act(() => useLayout.setState((l) => ({ main: { ...l.main, focusedPane } }) as never));
    holding(1);
    focusNothing();
    await pressAll(document.body);
    expect(answered()).toEqual([]);
    holding(0);
    await press(document.body, ESCAPE);
    await waitFor(() => expect(answered()).toEqual([{ requestId: 'rp', answer: DENY }]));
  });
});

describe('with no prompt in view', () => {
  it('the composer’s Esc and ⌘↩ are its own, as before', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    await scrollPrompt(2400);
    focusOn(editor()!);
    await press(editor()!, ESCAPE);
    await waitFor(() => expect(fake.invoked('session.interrupt')).toHaveLength(1)); // a running turn's Esc: Stop
    await type('after the turn');
    await press(editor()!, CMD_ENTER);
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(answered()).toEqual([]);
  });

  it('scrolled back into view, it re-arms before its keys answer', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    arm();
    await scrollPrompt(2400);
    await scrollPrompt(0);
    focusOn(endRow());
    await press(endRow(), ESCAPE);
    await flush();
    expect(answered()).toEqual([]);
    arm();
    await press(endRow(), ESCAPE);
    await waitFor(() => expect(answered()).toEqual([{ requestId: 'rp', answer: DENY }]));
  });
});

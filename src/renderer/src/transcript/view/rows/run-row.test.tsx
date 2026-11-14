// UX wave U2 (O-29, O-27, ticket 479; the U2a execution document, M4 and acceptance 1, 3, 4, 5 and 6): a run's row in the
// window. Each sequence is driven through the reducer (the store's own source, one batch per step) and read in the
// rendered rows after every step: one line, folded, reading the running call, the waiting call or the caption; a request
// that neither opens nor closes it; the live thought under it and the thought lines of an opened run at their places.
// Every command, word and number is invented, but for the one recorded session named (uxwave/u4p2-k-mcp-1).
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { loadUxwaveJournal } from '../../../../../../test/support/fixtures';
import { useAttention } from '../../../stores/attention';
import { useTranscriptStore } from '../../../stores/transcript';
import { CLOSE_MOTION } from '../../../ui/disclosure';
import { journalToEvents } from '../../dev/journal';
import { turnDerivations } from '../../model/derive';
import type { Row, TurnId } from '../../model/rows';
import { api, BASH_RESULT, builder, request, tool, uuid, type Builder } from '../../model/test-events';
import { Disclosures, TranscriptProvider } from '../context';
import { RowView } from './Row';
import { spyActions, storeWith } from './test-support';

afterEach(() => {
  cleanup();
  useAttention.setState({ bySession: new Map(), version: useAttention.getState().version + 1 });
});

// The rendered rows of the store's key: runs, calls and thoughts as the window draws them, the rest as a marker
const DRAWN = new Set<Row['kind']>(['group', 'cell', 'thinking']);
function Rows({ storeKey }: { storeKey: string }) {
  const rows = useTranscriptStore((state) => state.entries[storeKey]?.rows ?? []);
  return <>{rows.filter((row) => row.kind !== 'time' && row.kind !== 'user' && row.kind !== 'divider').map((row) => (
    <div key={row.id} data-row={row.id} data-kind={row.kind}>{DRAWN.has(row.kind) ? <RowView row={row} /> : null}</div>
  ))}</>;
}

async function scene(first: (b: Builder) => void) {
  const b = builder();
  b.turn('u1');
  first(b);
  const store = await storeWith([...b.events]);
  const turn = useTranscriptStore.getState().entries[store.key]!.state.order[0] as TurnId;
  // the turn is expanded, and stays so once it closes, so its run is drawn before and after (an open turn reads as
  // expanded until the reader collapses it: the first toggle collapses it, the second records it as expanded)
  const open = useTranscriptStore.getState().entries[store.key]!.state.turns.get(turn)!.state === 'open';
  for (let i = 0; i < (open ? 2 : 1); i += 1) useTranscriptStore.getState().toggleTurn(store.key, turn);
  const value = { storeKey: store.key, variant: 'session' as const, actions: spyActions(), rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't', effort: 'high' };
  const view = render(<TranscriptProvider value={value}><Rows storeKey={store.key} /></TranscriptProvider>);
  let sent = b.events.length;
  const step = (add: (b: Builder) => void) => {
    add(b);
    const batch = b.events.slice(sent);
    sent = b.events.length;
    act(() => store.push(batch));
  };
  const order = () => [...view.container.querySelectorAll<HTMLElement>('[data-row]')].map((element) => `${element.dataset.kind} ${element.dataset.row}`);
  const run = () => view.container.querySelector<HTMLElement>('[data-kind="group"] .transcript-group')!;
  const line = () => run().querySelector<HTMLButtonElement>('.transcript-run-line')!;
  const toggle = () => act(() => { fireEvent.click(line()); });
  const blocks = () => [...run().querySelectorAll<HTMLElement>('[data-group-cells], .transcript-thinking')].map((element) => (element.matches('[data-group-cells]')
    ? `calls ${[...element.querySelectorAll('[data-cell-id]')].map((cell) => cell.getAttribute('data-cell-id')).join(',')}` : `thought ${element.textContent}`));
  return { b, store, view, step, order, run, line, toggle, blocks, turn };
}

const SESSION_AT = '2026-09-28T10:00:00.000Z';
const permissionItem = (key: string, toolUseId: string, agentId: string | null = null): AttentionItem => ({
  id: `att-${key}` as AttentionId, appSessionId: 'x' as AppSessionId, sessionId: null, kind: 'permission',
  request: { requestId: key as RequestId, toolUseId: toolUseId as ToolUseId, taskId: null, agentId: agentId as never }, summary: 'Approval needed', createdAt: SESSION_AT, state: 'pending', stateChangedAt: SESSION_AT, expiresAt: null,
});
// What the attention service publishes for the session (the reducer is not its source): the store's list for the key
const attention = (key: string, items: AttentionItem[]) => act(() => {
  useAttention.setState({ bySession: new Map([[key as AppSessionId, items.map((item) => ({ ...item, appSessionId: key as AppSessionId }))]]), version: useAttention.getState().version + 1 });
});
const asked = (b: Builder, r: string, t: string) => b.emit('permission.requested', { requestId: request(r), toolUseId: tool(t), toolName: 'Bash', displayName: null, input: {}, description: null, decisionReasonType: null, suggestions: [], blockedPath: null });
const answered = (b: Builder, r: string, t: string, resolvedBy: 'user' | 'abort' = 'user') => b.emit('permission.resolved', { requestId: request(r), toolUseId: tool(t), behavior: resolvedBy === 'user' ? 'allow' : 'deny', message: null, updatedInput: null, updatedPermissions: [], resolvedBy });
const thought = (b: Builder, apiId: string, index: number, text: string, ms?: number) => b.emit('assistant.block.complete', {
  messageUuid: uuid(`${apiId}-u${index}`), apiMessageId: api(apiId), blockIndex: index, block: { type: 'thinking', thinking: text, signature: '' }, model: 'claude-test',
  supersedes: [], aborted: false, userMessageUuids: [], ...(ms !== undefined && { thinkingDurationMs: ms }),
});
const delta = (b: Builder, apiId: string, index: number, text: string) => b.emit('assistant.block.delta', {
  apiMessageId: api(apiId), blockIndex: index, blockType: 'thinking', textDelta: null, thinkingDelta: text, inputJsonDelta: null, userMessageUuid: null,
});
const command = (b: Builder, id: string, apiId = `msg-${id}`, index = 0) => {
  b.toolUse(id, 'Bash', { command: `make ${id}` }, apiId, index);
  b.result(id, 'ok', { structured: BASH_RESULT('ok') });
};

describe('a request on a run of one', () => {
  it('the call starts, its permission waits, the reader opens and closes the run, the answer and the result come: one row and one id throughout', async () => {
    const s = await scene((b) => b.toolUse('t1', 'Bash', { command: 'pnpm test' }));
    const row = s.run();
    expect(s.order()).toEqual(['group group:cell:t1']);
    expect(s.line().textContent).toBe('Running pnpm test');
    expect(s.line().dataset.line).toBe('running');
    expect(s.line().getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelectorAll('[data-cell-id]')).toHaveLength(0); // folded: no call is mounted

    s.step((b) => asked(b, 'r1', 't1'));
    attention(s.store.key, [permissionItem('r1', 't1')]);
    expect(s.run()).toBe(row);
    expect(s.order()).toEqual(['group group:cell:t1', 'request_slot slot:r1']);
    expect(s.line().textContent).toBe('◐Waiting for approval: pnpm test');
    expect(s.line().dataset).toMatchObject({ line: 'waiting', tone: 'warning' });
    expect(s.line().querySelector('.transcript-counts')).toBeNull();

    s.toggle();
    expect(s.line().getAttribute('aria-expanded')).toBe('true');
    expect(s.blocks()).toEqual(['calls cell:t1']);
    s.toggle();
    expect(s.line().getAttribute('aria-expanded')).toBe('false');
    expect(s.order()).toEqual(['group group:cell:t1', 'request_slot slot:r1']);
    expect(s.line().dataset.line).toBe('waiting');

    s.step((b) => answered(b, 'r1', 't1'));
    attention(s.store.key, []);
    expect(s.line().textContent).toBe('Running pnpm test');
    s.step((b) => b.result('t1', 'ok', { structured: BASH_RESULT('ok') }));
    expect(s.run()).toBe(row);
    expect(s.order()).toEqual(['group group:cell:t1']);
    expect(s.line().textContent).toBe('Ran a command');
    expect(s.line().dataset.line).toBe('caption');
  });
});

describe('a request between two calls of one message', () => {
  it('one line for both throughout; the open state the reader set before the request is the state after the answer', async () => {
    const s = await scene((b) => b.toolUse('t1', 'Bash', { command: 'pnpm test' }, 'm1', 0));
    const row = s.run();
    s.toggle();
    s.step((b) => asked(b, 'r1', 't1'));
    attention(s.store.key, [permissionItem('r1', 't1')]);
    s.step((b) => b.toolUse('t2', 'Bash', { command: 'pnpm lint' }, 'm1', 1));
    expect(s.order()).toEqual(['group group:cell:t1', 'request_slot slot:r1']);
    expect(s.line().textContent).toBe('◐Waiting for approval: pnpm test');
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2']);
    s.step((b) => answered(b, 'r1', 't1'));
    attention(s.store.key, []);
    expect(s.run()).toBe(row);
    expect(s.order()).toEqual(['group group:cell:t1']);
    expect(s.line().getAttribute('aria-expanded')).toBe('true');
    expect(s.line().textContent).toBe('Running pnpm lint');
  });
});

describe('a request that leaves with no answer', () => {
  it('the line reads the running call again and the row is the one it was', async () => {
    const s = await scene((b) => b.toolUse('t1', 'Bash', { command: 'pnpm test' }));
    const row = s.run();
    s.step((b) => asked(b, 'r1', 't1'));
    attention(s.store.key, [permissionItem('r1', 't1')]);
    expect(s.line().dataset.line).toBe('waiting');
    s.step((b) => answered(b, 'r1', 't1', 'abort'));
    attention(s.store.key, []);
    expect(s.run()).toBe(row);
    expect(s.order()).toEqual(['group group:cell:t1']);
    expect(s.line().textContent).toBe('Running pnpm test');
  });
});

describe('a permission that names no call of the turn', () => {
  it('a run whose last call has no result reads its caption, with no spinner; the same item naming an agent leaves the running label', async () => {
    const s = await scene((b) => { command(b, 't1'); b.toolUse('t2', 'Bash', { command: 'pnpm lint' }); });
    expect(s.line().dataset.line).toBe('running');
    attention(s.store.key, [permissionItem('req-terminal', 'req-terminal')]); // a terminal's request with no call id: keyed by its own id
    expect(s.line().dataset.line).toBe('caption');
    expect(s.line().textContent).toBe('Ran 2 commands');
    attention(s.store.key, [permissionItem('req-terminal', 'req-terminal', 'agent-1')]);
    expect(s.line().dataset.line).toBe('running');
    expect(s.line().textContent).toBe('Running pnpm lint');
  });
});

describe('a call in the background beside a later one (uxwave/u4p2-k-mcp-1 up to seq 55, then one constructed call)', () => {
  it('the line reads the constructed call, never the moved one; with it finished, the caption', async () => {
    const recorded = journalToEvents(loadUxwaveJournal('u4p2-k-mcp-1').filter((row) => row.seq <= 55));
    const later = builder(new Date(Date.parse(recorded.at(-1)!.at) + 1_000).toISOString());
    const store = await storeWith(recorded);
    const value = { storeKey: store.key, variant: 'session' as const, actions: spyActions(), rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't' };
    const view = render(<TranscriptProvider value={value}><Rows storeKey={store.key} /></TranscriptProvider>);
    const line = () => view.container.querySelector<HTMLButtonElement>('[data-kind="group"] .transcript-run-line')!;
    expect(line().dataset.line).toBe('caption'); // only the moved call runs
    later.toolUse('t-later', 'Bash', { command: 'pnpm lint' });
    act(() => store.push(later.events.map((event, i) => ({ ...event, sessionId: recorded[0]!.sessionId, seq: 1_000 + i }) as SessionEvent)));
    expect(line().dataset.line).toBe('running');
    expect(line().textContent).toBe('Running pnpm lint');
    later.result('t-later', 'ok', { structured: BASH_RESULT('ok') });
    act(() => store.push([{ ...later.events.at(-1)!, sessionId: recorded[0]!.sessionId, seq: 1_010 } as SessionEvent]));
    expect(line().dataset.line).toBe('caption');
  });
});

describe('a thought after a run, by prefixes of one turn’s events', () => {
  const twoCalls = (b: Builder) => { command(b, 't1'); command(b, 't2'); };
  const begin = async () => {
    const s = await scene(twoCalls);
    const row = s.run();
    expect(s.line().textContent).toBe('Ran 2 commands');
    s.step((b) => delta(b, 'm3', 0, ''));
    expect(s.run()).toBe(row);
    expect(s.order()).toEqual(['group group:cell:t1']);
    expect(row.querySelector(':scope > .transcript-thinking [data-shimmer]')?.textContent).toMatch(/^Thinking with high effort · /);
    s.step((b) => delta(b, 'm3', 0, 'Comparing the'));
    act(() => { fireEvent.click(row.querySelector<HTMLButtonElement>(':scope > .transcript-thinking button')!); });
    const derived = turnDerivations.count;
    s.step((b) => delta(b, 'm3', 0, ' two outputs.'));
    expect(row.querySelector(':scope > .transcript-thinking .transcript-thinking-text')?.textContent).toBe('Comparing the two outputs.');
    expect(turnDerivations.count).toBe(derived); // a delta derives no turn
    return { s, row };
  };

  it('ending at 4 s, it has no line, folded or opened; then the answer: the same row, completed, the thought nowhere', async () => {
    const { s, row } = await begin();
    s.step((b) => thought(b, 'm3', 0, 'Comparing the two outputs.', 4_000));
    expect(row.querySelector('.transcript-thinking')).toBeNull();
    s.toggle();
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2']);
    s.step((b) => { b.text('m3', 1, 'Both match.'); b.end(['u1']); });
    expect(s.run()).toBe(row);
    expect(row.dataset.state).toBe('completed');
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2']);
    expect(s.order()).toEqual(['group group:cell:t1', 'assistant_text text:m3:1']);
  });

  it('ending at 12 s: nothing folded; opened, a trailing line under the last block; a call follows: the line between two blocks', async () => {
    const { s, row } = await begin();
    s.step((b) => thought(b, 'm3', 0, 'Comparing the two outputs.', 12_000));
    expect(row.querySelector(':scope > .transcript-thinking')).toBeNull();
    s.toggle();
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2', 'thought Thought for 12sComparing the two outputs.']); // its text was left open
    s.step((b) => command(b, 't3', 'm3', 1));
    expect(s.run()).toBe(row);
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2', 'thought Thought for 12sComparing the two outputs.', 'calls cell:t3']);
  });

  it('ending at 12 s, then the turn’s answer: the same row, completed, the line under the last block', async () => {
    const { s, row } = await begin();
    s.step((b) => thought(b, 'm3', 0, 'Comparing the two outputs.', 12_000));
    s.toggle();
    s.step((b) => { b.text('m3', 1, 'Both match.'); b.end(['u1']); });
    expect(s.run()).toBe(row);
    expect(row.dataset.state).toBe('completed');
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2', 'thought Thought for 12sComparing the two outputs.']);
  });
});

// M4's review (Minor): the live thought of a run being folded is drawn once while the body's exit runs, inside the body,
// and under the line once the body is gone; never in both places at once
describe('a run folded while its thought streams', () => {
  afterEach(() => vi.useRealTimers());

  it('draws the live thought once through the body’s exit: in the body until it unmounts, then under the line', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = await scene((b) => { command(b, 't1'); command(b, 't2'); delta(b, 'm3', 0, 'Comparing the'); });
    const thoughts = () => s.run().querySelectorAll('.transcript-thinking');
    const body = () => s.run().querySelector(`[id="${s.line().getAttribute('aria-controls')!}"]`);
    const folded = () => s.run().querySelectorAll(':scope > .transcript-thinking');
    expect(thoughts()).toHaveLength(1);
    expect(folded()).toHaveLength(1);
    s.toggle();
    act(() => vi.runOnlyPendingTimers()); // the opening motion ends
    expect(thoughts()).toHaveLength(1);
    expect(folded()).toHaveLength(0);
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2', expect.stringMatching(/^thought Thinking with high effort · /)]);
    s.toggle();
    expect(s.line().getAttribute('aria-expanded')).toBe('false');
    expect(body()).not.toBeNull(); // the body is still leaving
    expect(thoughts()).toHaveLength(1);
    expect(folded()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(CLOSE_MOTION.ms));
    expect(body()).toBeNull();
    expect(thoughts()).toHaveLength(1);
    expect(folded()).toHaveLength(1);
  });
});

describe('a thought after a single call', () => {
  it('while the turn is open, a line and the live label under it; at the close, the call’s row and then the thought’s, the thought’s only if it has text', async () => {
    for (const text of ['Checking once more.', '']) {
      const s = await scene((b) => command(b, 't1'));
      s.step((b) => delta(b, 'm2', 0, ''));
      expect(s.order()).toEqual(['group group:cell:t1']);
      expect(s.run().querySelector(':scope > .transcript-thinking [data-shimmer]')).not.toBeNull();
      s.step((b) => { thought(b, 'm2', 0, text, 4_000); b.text('m2', 1, 'Done.'); b.end(['u1']); });
      expect(s.order()).toEqual(text ? ['cell cell:t1', 'thinking think:m2:0', 'assistant_text text:m2:1'] : ['cell cell:t1', 'assistant_text text:m2:1']);
      cleanup();
    }
  });
});

describe('a thought left unfinished when its turn closed', () => {
  it('is not live and has no line', async () => {
    const s = await scene((b) => { command(b, 't1'); command(b, 't2'); });
    s.step((b) => delta(b, 'm3', 0, 'Halfway'));
    expect(s.run().querySelector('[data-shimmer]')).not.toBeNull();
    s.step((b) => b.end(['u1']));
    expect(s.run().querySelector('[data-shimmer]')).toBeNull();
    s.toggle();
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2']);
  });
});

describe('an opened run’s thought lines', () => {
  it('two thoughts of 6 s with no call between them are one line of 12 s; a run whose every thought is shorter opens to one block', async () => {
    const merged = await scene((b) => { command(b, 't1'); thought(b, 'm2', 0, 'Part one.', 6_000); thought(b, 'm2', 1, 'Part two.', 6_000); command(b, 't2', 'm2', 2); });
    merged.toggle();
    expect(merged.blocks()).toEqual(['calls cell:t1', 'thought Thought for 12s', 'calls cell:t2']);
    act(() => { fireEvent.click(merged.run().querySelector<HTMLButtonElement>('.transcript-thinking button')!); });
    expect(merged.run().querySelector('.transcript-thinking-text')?.textContent).toBe('Part one.\n\nPart two.');
    cleanup();
    const short = await scene((b) => { command(b, 't1'); thought(b, 'm2', 0, 'Brief.', 9_000); command(b, 't2', 'm2', 1); });
    short.toggle();
    expect(short.blocks()).toEqual(['calls cell:t1,cell:t2']);
  });

  it('a thought of 12 s with no text has no chevron, and its label starts where a line with a chevron starts its label', async () => {
    const s = await scene((b) => { command(b, 't1'); thought(b, 'm2', 0, '', 12_000); command(b, 't2', 'm2', 1); });
    s.toggle();
    const line = s.run().querySelector('.transcript-thinking')!;
    expect(line.querySelector('button')).toBeNull();
    expect(line.querySelector('svg.transcript-chevron')).toBeNull();
    const box = line.querySelector('.transcript-disclosure')!;
    expect(box.firstElementChild?.className).toBe('transcript-chevron'); // the chevron's box, kept empty
    expect(box.textContent).toBe('Thought for 12s');
  });

  it('a thought that streamed for 12 s on an event with no recorded duration has no line inside a run, and reads Thought for 12s as a row outside one', async () => {
    const s = await scene((b) => { command(b, 't1'); delta(b, 'm2', 0, 'Long'); b.tick(11_900); thought(b, 'm2', 0, 'Long look.'); command(b, 't2', 'm2', 1); });
    s.toggle();
    expect(s.blocks()).toEqual(['calls cell:t1,cell:t2']);
    cleanup();
    const outside = await scene((b) => { delta(b, 'm1', 0, 'Long'); b.tick(11_900); thought(b, 'm1', 0, 'Long look.'); b.text('m1', 1, 'Hello.'); b.end(['u1']); });
    expect(outside.view.container.querySelector('[data-kind="thinking"] button')?.textContent).toBe('Thought for 12s');
  });

  it('a folded run mounts no call; a jump to a call inside it opens it and lands on the row', async () => {
    const s = await scene((b) => { command(b, 't1'); command(b, 't2'); b.end(['u1']); });
    expect(s.run().querySelectorAll('[data-cell-id]')).toHaveLength(0);
    act(() => useTranscriptStore.getState().jumpTo(s.store.key, 'cell:t2' as never));
    expect(s.line().getAttribute('aria-expanded')).toBe('true');
    expect(s.run().querySelector('[data-cell-id="cell:t2"]')).not.toBeNull();
    expect(useTranscriptStore.getState().entries[s.store.key]!.jump).toMatchObject({ focus: 'cell:t2' });
  });
});

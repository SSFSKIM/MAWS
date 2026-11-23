// Board ticket 850: every fold of the transcript opens and closes through the one disclosure motion (`ui/disclosure.tsx`:
// 300 ms open, 150 ms close, nothing under reduced motion): the to-human view's stretch (its rows are rows of the list,
// moved as a turn's work area is), a long message's Show more, a rewound branch's reveal, a browser action's detail, the
// glyphs a subagent row's `+N` reveals, a shell call's whole command and an arrival line's whole text. A local command's
// output, whose bound the row measures, is pinned beside its measurement (`rows/LocalCommand.test.tsx`). Layout is
// stubbed (`test-support/motion-layout.ts`). Every text is invented.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { advance, closing, opening, reduceMotion, restoreMotionLayout, stubMotionLayout, type MotionStart } from '../../test-support/motion-layout';
import { mirrorRows } from '../../owner/view/mirror';
import { rowsOf } from '../model/derive';
import { applyEvents, createState, withUi } from '../model/reduce';
import type { Cell, Row, SubagentRef } from '../model/rows';
import { BASH_RESULT, builder, uuid } from '../model/test-events';
import type { TranscriptSource } from '../source/types';
import { Disclosures, NO_ACTIONS, TranscriptProvider, type TranscriptContextValue } from './context';
import { WorkMotion } from './motion';
import { RowView } from './rows/Row';
import { renderRow, spyActions, storeWith } from './rows/test-support';

const AT = '2026-11-23T10:00:00.000Z';
let starts: MotionStart[] = [];
beforeEach(() => {
  starts = stubMotionLayout();
});
afterEach(() => {
  cleanup();
  restoreMotionLayout();
});

const press = (name: string | RegExp, within_: HTMLElement = document.body) => fireEvent.click(within(within_).getByRole('button', { name }));

describe('a body that mounts and unmounts: it grows in, and goes only once its close has run', () => {
  const notice: Row = { id: 'notice:1' as never, turnId: null, at: AT, kind: 'notice', class: 'task', outcome: 'completed', text: 'Background task finished', durationMs: null, detail: 'All 42 files checked.', taskId: null, toolUseId: null, outputFile: null };
  const message: Row = { id: 'agent:1' as never, turnId: null, at: AT, kind: 'agent_message', direction: 'from_child', from: null, to: null, text: 'Done with the scan', flow: 'in', body: 'Done with the scan, and the report is in the folder.' };
  const browser: Row = {
    id: 'browser:t1' as never, turnId: null, at: AT, kind: 'browser_action', toolUseId: 't1' as never, tool: 'browser_snapshot', action: 'snapshot', tabId: 'b_000000000001', target: null,
    targetRole: null, targetName: null, value: null, url: 'https://example.com/form', title: 'Order form', ms: 40, deliverableId: null, error: null, waitedFor: null, waitedMs: null,
    chars: 30, truncated: false, tabCount: null, state: 'done', detail: 'heading "Order form"', answered: true,
  };
  const cases: [string, Row, () => HTMLElement, () => Element | null][] = [
    ['a notice line’s whole sentence', notice, () => screen.getByRole('button', { expanded: false }), () => document.querySelector('.transcript-notice-detail')],
    ['an agent message line’s whole text', message, () => screen.getByRole('button', { expanded: false }), () => document.querySelector('.transcript-peer-body')],
    ['a browser action’s detail', browser, () => screen.getByRole('button', { name: /Show/ }), () => document.querySelector('.transcript-output')],
  ];
  for (const [name, row, control, body] of cases) {
    it(`${name}: 300 ms in from nothing, 150 ms out, then gone`, () => {
      renderRow(row, { storeKey: 'app-motion' });
      expect(body()).toBeNull();
      fireEvent.click(control());
      expect(starts.at(-1)).toMatchObject({ height: '0px', opacity: '0', transform: 'translateY(-8px)' });
      expect(opening(body()!.parentElement)).toBe(true);
      advance(300);
      expect(body()!.parentElement!.style.height).toBe('');
      fireEvent.click(screen.getAllByRole('button', { expanded: true })[0]!);
      expect(closing(body()!.parentElement)).toBe(true);
      advance(149);
      expect(body()).not.toBeNull();
      advance(1);
      expect(body()).toBeNull();
    });

    it(`${name}: under reduced motion, at once`, () => {
      reduceMotion();
      renderRow(row, { storeKey: 'app-motion' });
      fireEvent.click(control());
      expect(body()!.parentElement!.style.transition).toBe('');
      fireEvent.click(screen.getAllByRole('button', { expanded: true })[0]!);
      expect(body()).toBeNull();
      expect(starts).toEqual([]);
    });
  }

  const agent = (n: number): SubagentRef => ({ taskId: `task-${n}` as never, agentId: null, toolUseId: null, name: `scout-${n}`, glyph: n, kind: 'agent', subagentType: null });
  const agents: Row = { id: 'subagent:1' as never, turnId: null, at: AT, kind: 'subagent', agents: [1, 2, 3, 4, 5, 6].map(agent), sentence: 'Six agents finished', status: 'finished', overflow: 2 };
  const more = () => document.querySelector('[data-glyphs-more]');

  it('the glyphs a subagent row’s +N reveals: in, and out once the close has run', () => {
    renderRow(agents, { actions: spyActions() });
    expect(more()).toBeNull();
    press('+2 more agents');
    expect(opening(more())).toBe(true);
    expect(within(more() as HTMLElement).getAllByRole('button')).toHaveLength(2);
    advance(300);
    press('+2 more agents');
    expect(closing(more())).toBe(true);
    advance(150);
    expect(more()).toBeNull();
  });

  it('the glyphs a subagent row’s +N reveals: under reduced motion, at once', () => {
    reduceMotion();
    renderRow(agents, { actions: spyActions() });
    press('+2 more agents');
    expect((more() as HTMLElement).style.transition).toBe('');
    press('+2 more agents');
    expect(more()).toBeNull();
  });
});

describe('a bounded preview: it moves between its bound and its whole, and stays drawn', () => {
  const longText = Array.from({ length: 30 }, (_, i) => `Line ${i} of a long message.`).join('\n\n');
  const user: Row = { id: 'user:1' as never, turnId: null, at: AT, kind: 'user', messageUuid: null, text: longText, attachments: [], placeholders: [], lines: 59, editable: false, steer: false, dropped: false };
  const content = () => document.querySelector<HTMLElement>('[data-user-content]')!;

  it('a long message’s Show more opens from its bound over 300 ms, and Show less closes to it over 150 ms', () => {
    renderRow(user);
    press('Show more');
    expect(starts.at(-1)).toMatchObject({ height: '48px', opacity: '' });
    expect(opening(content())).toBe(true);
    expect(content().style.height).toBe('120px');
    advance(300);
    press('Show less');
    expect(starts.at(-1)).toMatchObject({ height: '120px' });
    expect(closing(content())).toBe(true);
    expect(content().style.height).toBe('48px');
    advance(150);
    expect(content().getAttribute('style')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show more' })).not.toBeNull(); // measured again once at rest
  });

  it('a long message under reduced motion opens and closes at once', () => {
    reduceMotion();
    renderRow(user);
    press('Show more');
    press('Show less');
    expect(starts).toEqual([]);
    expect(content().getAttribute('style')).toBeNull();
  });

  async function shell() {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: Array.from({ length: 9 }, (_, i) => `echo ${i}`).join('\n') });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.end(['u1']);
    const store = await storeWith(b.events);
    useTranscriptStore.getState().expandAll(store.key);
    useTranscriptStore.getState().toggleCell(store.key, 'cell:t1' as Cell['id']);
    renderRow(store.rows().find((row) => row.id === 'cell:t1' || (row.kind === 'group' && row.cells.some((cell) => cell.id === 'cell:t1')))!, { storeKey: store.key });
    return () => document.querySelector<HTMLElement>('.transcript-shell-command')!;
  }

  it('a shell call’s whole command opens from its bound over 300 ms and closes to it over 150 ms', async () => {
    const command = await shell();
    press('Show more');
    expect(starts.at(-1)).toMatchObject({ height: '48px' });
    expect(opening(command())).toBe(true);
    advance(300);
    press('Show less');
    expect(closing(command())).toBe(true);
    expect(command().style.height).toBe('48px');
    advance(150);
    expect(command().hasAttribute('data-bounded')).toBe(true);
    expect(command().getAttribute('style')).toBeNull();
  });

  it('a shell call’s whole command under reduced motion, at once', async () => {
    reduceMotion();
    const command = await shell();
    press('Show more');
    expect(command().getAttribute('style')).toBeNull();
    expect(starts).toEqual([]);
  });
});

// The rows a fold adds to the list or takes from it: each mounts through the motion, as a turn's work area does.
describe('a fold whose body is rows of the list', () => {
  // A list of rows through `RowView`, as `Transcript` draws them, with one motion for the mount.
  function List({ storeKey, rows }: { storeKey: string; rows: readonly Row[] }) {
    const [motion] = useState(() => new WorkMotion());
    const [context] = useState<TranscriptContextValue>(() => ({ storeKey, variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't', motion }));
    return <TranscriptProvider value={context}>{rows.map((row) => <RowView key={row.id} row={row} />)}</TranscriptProvider>;
  }
  function KeyRows({ storeKey }: { storeKey: string }) {
    const rows = useTranscriptStore((state) => state.entries[storeKey]?.rows) ?? [];
    return <List storeKey={storeKey} rows={rows} />;
  }
  const flush = () => act(async () => {});
  const wrapper = (kind: string) => document.querySelectorAll<HTMLElement>(`.transcript-row[data-kind="${kind}"]`);

  describe('a rewound branch, revealed and hidden by its boundary', () => {
    async function rewound() {
      const b = builder();
      b.turn('u1', 'First');
      b.text('m1', 0, 'One');
      b.end(['u1']);
      b.turn('u2', 'Second');
      b.text('m2', 0, 'Two');
      b.end(['u2']);
      b.emit('boundary.rewind', { targetMessageUuid: uuid('u2'), precedingAssistantUuid: uuid('m1-u0'), prefillText: 'Second' });
      const store = await storeWith(b.events);
      render(<KeyRows storeKey={store.key} />);
      await flush();
      return store;
    }
    const branch = () => [...document.querySelectorAll<HTMLElement>('.transcript-row[data-muted]')];

    it('revealed, its rows grow in over 300 ms; hidden, they close over 150 ms before the store hides them; a second press takes the hide back', async () => {
      await rewound();
      expect(branch()).toHaveLength(0);
      press('Show');
      await flush();
      expect(branch().length).toBeGreaterThan(0);
      for (const row of branch()) expect(opening(row), row.dataset.kind).toBe(true);
      expect(opening(wrapper('boundary')[0]!)).toBe(false);
      advance(300);
      press('Hide');
      for (const row of branch()) expect(closing(row)).toBe(true);
      advance(80);
      press('Show'); // taken back mid-close
      advance(300);
      expect(branch().length).toBeGreaterThan(0);
      press('Hide');
      advance(149);
      expect(branch().length).toBeGreaterThan(0);
      advance(1);
      await flush();
      expect(branch()).toHaveLength(0);
    });

    it('under reduced motion, hidden at once', async () => {
      reduceMotion();
      await rewound();
      press('Show');
      await flush();
      expect(branch().length).toBeGreaterThan(0);
      expect(branch().every((row) => row.style.transition === '')).toBe(true);
      press('Hide');
      await flush();
      expect(branch()).toHaveLength(0);
    });
  });

  describe('a stretch of the to-human view, opened and folded by its record line', () => {
    const KEY = 'motion-stretch';
    afterEach(() => useTranscriptStore.getState().drop(KEY));
    // `head`: a mixed reply (a message and words of its own) that heads the stretch, in sight whether it is open or not
    function viewRows(head?: string): Row[] {
      const b = builder();
      b.turn('u0', 'Set it up');
      b.text('m0', 0, '<message>Ready.</message>');
      b.end(['u0']);
      b.turn('u1', 'Check the files');
      if (head !== undefined) b.text('h1', 0, head);
      b.toolUse('t1', 'Bash', { command: 'ls' });
      b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
      b.toolUse('t2', 'Bash', { command: 'pwd' });
      b.result('t2', 'ok', { structured: BASH_RESULT('ok') });
      b.text('m1', 0, '<message>Both are there.</message>');
      b.end(['u1']);
      const state = applyEvents(createState(null, null), b.events);
      return rowsOf(withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 }));
    }
    function Mounted({ rows }: { rows: Row[] }) {
      useLayoutEffect(() => useTranscriptStore.getState().mountView(KEY, () => ({ rows, liveMarked: '' })), [rows]);
      const openStretches = useTranscriptStore((state) => state.entries[KEY]?.state.ui.openStretches);
      return <List storeKey={KEY} rows={mirrorRows(rows, { openStretches })} />;
    }
    async function mounted(head?: string) {
      const source: TranscriptSource = { key: KEY, subscribe: () => () => {}, snapshot: () => Promise.resolve([]) };
      await useTranscriptStore.getState().attach(KEY, source);
      const rows = viewRows(head);
      render(<Mounted rows={rows} />);
    }
    const line = (open: boolean) => document.querySelector<HTMLButtonElement>(`.owner-record-fold${open ? '[data-open]' : ':not([data-open])'} > button`);
    const recordLine = (open: boolean) => line(open)?.closest<HTMLElement>('.transcript-row') ?? null;
    const work = () => [...wrapper('group'), ...wrapper('cell')];
    const outside = () => [...wrapper('user'), ...wrapper('assistant_text')];

    it('opened, its rows and its fold line grow in over 300 ms, and the rows outside it do not move', async () => {
      await mounted();
      expect(work()).toHaveLength(0);
      await act(async () => {
        fireEvent.click(line(false)!);
      });
      expect(work().length).toBeGreaterThan(0);
      for (const row of work()) expect(opening(row)).toBe(true);
      expect(opening(recordLine(true))).toBe(true);
      for (const row of outside()) expect(row.style.transition).toBe('');
      advance(300);
      for (const row of work()) expect(row.getAttribute('style')).toBeNull();
    });

    it('folded, its rows and its fold line close over 150 ms before the store folds it; a second press takes the fold back', async () => {
      await mounted();
      await act(async () => {
        fireEvent.click(line(false)!);
      });
      advance(300);
      fireEvent.click(line(true)!);
      for (const row of work()) expect(closing(row)).toBe(true);
      expect(closing(recordLine(true))).toBe(true);
      expect(line(true)!.getAttribute('aria-expanded')).toBe('false');
      advance(80);
      fireEvent.click(line(true)!); // taken back
      advance(300);
      expect(work().length).toBeGreaterThan(0);
      expect(line(true)!.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(line(true)!);
      advance(149);
      expect(work().length).toBeGreaterThan(0);
      advance(1);
      expect(work()).toHaveLength(0);
      expect(line(false)).not.toBeNull();
    });

    // The review of 2026-11-23: a mixed head stays in sight in both states (closed, only its message), so the fold moves
    // only the rows it adds and takes away.
    it('a mixed reply that heads the stretch does not move, opened or folded', async () => {
      await mounted('Looking at the tree first. <message>Starting on the files.</message>');
      const head = () => [...wrapper('assistant_text')].find((row) => row.textContent?.includes('Starting on the files.'))!;
      expect(head()).toBeDefined();
      await act(async () => {
        fireEvent.click(line(false)!);
      });
      expect(work().every((row) => opening(row))).toBe(true);
      expect(head().style.transition).toBe('');
      advance(300);
      fireEvent.click(line(true)!);
      expect(work().every((row) => closing(row))).toBe(true);
      expect(head().style.transition).toBe('');
      advance(150);
      expect(work()).toHaveLength(0);
      expect(head().style.transition).toBe('');
      expect(head().textContent).toContain('Starting on the files.');
    });

    // The review of 2026-11-23: the fold hands focus to the closed line only while the reader left it on the pressed line
    // (or nowhere); focus they moved elsewhere during the close stays there.
    it('folded, it hands focus to the closed line only where the reader left focus on the pressed line', async () => {
      await mounted();
      await act(async () => {
        fireEvent.click(line(false)!);
      });
      advance(300);
      line(true)!.focus();
      fireEvent.click(line(true)!);
      advance(150);
      expect(document.activeElement).toBe(line(false));

      await act(async () => {
        fireEvent.click(line(false)!);
      });
      advance(300);
      const elsewhere = document.body.appendChild(document.createElement('input'));
      line(true)!.focus();
      fireEvent.click(line(true)!);
      elsewhere.focus(); // the reader moved on before the close had run
      advance(150);
      expect(line(false)).not.toBeNull();
      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it('under reduced motion, it opens and folds at once', async () => {
      reduceMotion();
      await mounted();
      await act(async () => {
        fireEvent.click(line(false)!);
      });
      expect(work().every((row) => row.getAttribute('style') === null)).toBe(true);
      fireEvent.click(line(true)!);
      expect(work()).toHaveLength(0);
      expect(starts).toEqual([]);
    });
  });
});

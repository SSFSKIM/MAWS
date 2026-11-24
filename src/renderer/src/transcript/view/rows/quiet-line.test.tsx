// Board ticket 852: the bordered tool card retired. Every call that stands alone is the quiet line a run uses, with what
// the card showed at rest under it, indented, and no box: a failed call (its error mark and its error's first line), a
// denied one (its mark in the error tint, the turn line's jump target, which takes focus), a cua_repl `js` call (its
// browser activity indented under it), an image result (its thumbnail under the line), the one call of a completed run
// (its run's line), and a running call (the running ring in the mark's place). Which calls stand alone is unchanged.
// Every text is invented.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { useTranscriptStore } from '../../../stores/transcript';
import { browserActivityRow } from '../../model/browser-activity';
import { cellId, turnId } from '../../model/keys';
import type { Row } from '../../model/rows';
import { BASH_RESULT, builder, tool, uuid } from '../../model/test-events';
import type { TranscriptSource } from '../../source/types';
import { Transcript } from '../Transcript';
import { renderRow, rowOf, storeWith } from './test-support';

const JS = 'mcp__plugin_cua_cua_repl__js';
const IMAGE = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }];

// The renderer's own stylesheet, so a rule's computed value is the one the app draws. happy-dom drops a border shorthand
// that holds a custom property, so a border's colour token is read as a plain colour: a border declared anywhere is seen.
let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement('style');
  const css = readFileSync(join(__dirname, '../transcript.css'), 'utf8');
  style.textContent = css.replace(/border(?:-[a-z]+)*\s*:[^;}]*/g, (declaration) => declaration.replace(/var\(--[\w-]+\)/g, 'gray'));
  document.head.append(style);
});
afterAll(() => style.remove());
afterEach(() => {
  cleanup();
  useTranscriptStore.setState({ entries: {} });
});

// The store over the events, its first turn's work open (a closed turn folds it)
async function opened(events: SessionEvent[]) {
  const store = await storeWith(events);
  const first = useTranscriptStore.getState().entries[store.key].state.order[0];
  if (!store.rows().some((row) => row.kind === 'cell')) act(() => useTranscriptStore.getState().toggleTurn(store.key, first));
  return store;
}
const cells = (rows: Row[]) => rows.filter((row): row is Extract<Row, { kind: 'cell' }> => row.kind === 'cell');
const cellRow = (rows: Row[], call: string) => cells(rows).find((row) => row.toolUseId === call)!;
// A box: any side of an element drawn with a border. An image keeps the hairline frame its detail draws too.
const boxed = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('*')].filter((element) => {
  if (element.tagName === 'IMG') return false;
  const s = getComputedStyle(element);
  return [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle].some((side) => side !== '' && side !== 'none');
});

// One finished turn holding every case of the ticket's table that a closed turn can hold.
function everyCase(report = false) {
  const b = builder('2026-11-20T10:00:00.000Z');
  b.turn('u1', 'Tidy the notes');
  if (report) {
    b.toolUse('msg', 'mcp__maws__message', { text: 'Tidying the notes now.' }, 'm0', 0); // what the report view keeps in sight
    b.result('msg', [{ type: 'text', text: 'sent' }]);
  }
  b.toolUse('fail', 'Bash', { command: 'cat notes/missing.txt' }, 'm1', 0);
  b.result('fail', 'cat: notes/missing.txt: No such file or directory\nexit status 1', { isError: true });
  b.text('m2', 0, 'That file is gone.');
  b.toolUse('deny', 'Bash', { command: 'rm -rf notes' }, 'm3', 0);
  b.result('deny', 'Refused by an invented rule.', { isError: true, denial: 'permission-rule' });
  b.toolUse('js', JS, { code: "await page.goto('http://127.0.0.1:17391/')" }, 'm4', 0);
  b.result('js', 'ok');
  b.toolUse('shot', 'Read', { file_path: '/notes/shot.png' }, 'm5', 0);
  b.result('shot', IMAGE as never, { structured: { isImage: true } });
  b.toolUse('one', 'Bash', { command: 'ls notes', description: 'List the notes' }, 'm6', 0);
  b.result('one', 'alpha.txt', { structured: BASH_RESULT('alpha.txt') });
  b.text('m7', 0, 'Listed.');
  b.toolUse('r1', 'Read', { file_path: '/notes/alpha.txt' }, 'm8', 0);
  b.result('r1', 'alpha');
  b.toolUse('r2', 'Read', { file_path: '/notes/beta.txt' }, 'm8', 1);
  b.result('r2', 'beta');
  b.text('m9', 0, 'Done.');
  b.end(['u1']);
  return b.events;
}

describe('each case of the table, as a line', () => {
  it('failed: its error mark and its error’s first line on the line, no box; the whole error once it opens', async () => {
    const store = await opened(everyCase());
    const row = cellRow(store.rows(), 'fail');
    const view = renderRow(row, { storeKey: store.key });
    const cell = view.container.querySelector<HTMLElement>('[data-cell-id]')!;
    expect(cell.hasAttribute('data-standalone')).toBe(true);
    expect(cell.dataset.status).toBe('error');
    expect(style.textContent).toContain(".transcript-cell[data-status=\"error\"] > .transcript-cell-line::before { content: '✕'; color: var(--danger); }"); // its mark, in the error tint
    expect(cell.querySelector('.transcript-cell-reason')?.textContent).toBe('cat: notes/missing.txt: No such file or directory');
    expect(boxed(view.container)).toEqual([]);
    fireEvent.click(cell.querySelector('.transcript-cell-line')!);
    view.rerenderRow(cellRow(store.rows(), 'fail'));
    expect(view.container.textContent).toContain('exit status 1');
  });

  it('denied: its mark in the error tint with the reason on the line, focusable, no box', async () => {
    const store = await opened(everyCase());
    const row = cellRow(store.rows(), 'deny');
    const view = renderRow(row, { storeKey: store.key });
    const cell = view.container.querySelector<HTMLElement>('[data-cell-id]')!;
    expect([cell.dataset.status, cell.tabIndex, cell.hasAttribute('data-standalone')]).toEqual(['denied', -1, true]);
    expect(cell.querySelector('.transcript-cell-line')?.textContent).toMatch(/^Denied: rm -rf notes · /);
    expect(style.textContent).toContain('.transcript-cell[data-status="denied"] > .transcript-cell-line { color: var(--danger); }'); // the tint at rest
    expect(boxed(view.container)).toEqual([]);
  });

  it('cua_repl js: the line, its browser activity indented under it', async () => {
    const store = await opened(everyCase());
    const call = renderRow(cellRow(store.rows(), 'js'), { storeKey: store.key });
    expect(call.container.querySelector('[data-cell-id]')?.hasAttribute('data-standalone')).toBe(true);
    expect(boxed(call.container)).toEqual([]);
    const entry = { seq: 1, appSessionId: store.key, tabId: 'b_000000000001', at: '2026-11-20T10:00:01.000Z', activity: { kind: 'clicked', x: 1, y: 2, label: 'button Save' } } as const;
    const under = renderRow(browserActivityRow(entry as never, { toolUseId: tool('js'), turnId: turnId.ofMessage(uuid('u1')) }), { storeKey: store.key });
    const alone = renderRow(browserActivityRow({ ...entry, seq: 2 } as never), { storeKey: store.key });
    const indent = (root: HTMLElement) => getComputedStyle(root.querySelector('.transcript-browser-action')!).marginLeft || '0px';
    expect(indent(under.container)).toBe('19px'); // under its call, at the label's indent
    expect(indent(alone.container)).toBe('0px'); // a row at its own time stands at the margin
  });

  // The pair review of 2026-11-24: with no box whose corner held it, Raw opens the opened result's first row, under the
  // label, instead of floating at the column's far edge.
  it('cua_repl js opened: Raw at the start of its result, under the label', async () => {
    const store = await opened(everyCase());
    const view = renderRow(cellRow(store.rows(), 'js'), { storeKey: store.key });
    fireEvent.click(view.container.querySelector('.transcript-cell-line')!);
    view.rerenderRow(cellRow(store.rows(), 'js'));
    const heading = view.container.querySelector<HTMLElement>('.transcript-mcp > .transcript-detail-heading')!;
    expect(heading.querySelector('button')?.textContent).toBe('Raw');
    expect(getComputedStyle(heading).justifyContent).toBe('flex-start');
    expect(getComputedStyle(heading.closest('.transcript-cell-detail')!).marginLeft).toBe('19px');
  });

  it('an image result: its thumbnail under the line at rest, gone while the line is open', async () => {
    const store = await opened(everyCase());
    const view = renderRow(cellRow(store.rows(), 'shot'), { storeKey: store.key });
    const thumb = () => view.container.querySelector<HTMLImageElement>('[data-cell-id] > img.transcript-cell-thumb');
    expect(thumb()?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(getComputedStyle(thumb()!).marginLeft).toBe('19px');
    expect(boxed(view.container)).toEqual([]);
    fireEvent.click(view.container.querySelector('.transcript-cell-line')!);
    view.rerenderRow(cellRow(store.rows(), 'shot'));
    expect(thumb()).toBeNull();
    expect(view.container.querySelector('.transcript-cell-detail img.transcript-detail-image')).not.toBeNull();
  });

  // The owner's call of 2026-11-24: a run of one reads its call's description (the run's words only where it has none,
  // work.test.tsx's "Ran a command"), and one press opens it straight onto the command and its result, with no block.
  it('a run of one: a run’s line reading its call’s description, one press opening onto its command and result', async () => {
    const store = await opened(everyCase());
    const row = cellRow(store.rows(), 'one');
    expect(row.kind).toBe('cell'); // the rule that puts it apart is unchanged
    const view = renderRow(row, { storeKey: store.key });
    const line = screen.getByRole('button', { name: 'Listed the notes' });
    expect(line.className).toBe('transcript-run-line');
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector('[data-cell-id]')).toBeNull();
    expect(boxed(view.container)).toEqual([]);
    fireEvent.click(line);
    view.rerenderRow(cellRow(store.rows(), 'one'));
    expect(screen.getByRole('button', { name: 'Listed the notes' }).getAttribute('aria-expanded')).toBe('true');
    const call = view.container.querySelector<HTMLElement>(`[data-cell-id="${cellId.tool(tool('one'))}"][data-run-of-one]`)!;
    expect(call.querySelector('.transcript-shell-command')?.textContent).toBe('$ ls notes');
    expect(call.textContent).toContain('alpha.txt');
    expect([view.container.querySelector('.transcript-cell-line'), view.container.querySelector('.transcript-tool-block')]).toEqual([null, null]);
    expect(getComputedStyle(call.querySelector('.transcript-cell-detail')!).marginLeft).toBe('19px'); // under the label
  });

  it('running: the running ring in the mark’s place on a line with no box', async () => {
    const b = builder('2026-11-20T10:00:00.000Z');
    b.turn('u1', 'Open the page');
    b.toolUse('js', JS, { code: "await page.goto('http://127.0.0.1:17391/')" });
    const store = await opened(b.events);
    const view = renderRow(cellRow(store.rows(), 'js'), { storeKey: store.key });
    const cell = view.container.querySelector<HTMLElement>('[data-cell-id]')!;
    expect([cell.dataset.status, cell.hasAttribute('data-standalone')]).toEqual(['running', true]);
    expect(style.textContent).toMatch(/\.transcript-cell\[data-status="running"\] > \.transcript-cell-line::before,/); // the ring, on any call's line
    expect(boxed(view.container)).toEqual([]);
  });
});

// The space a standalone line and a run's line take, so consecutive standalone lines keep a run's rhythm (the list
// measures the row; happy-dom draws no layout, so the pictures check the drawn heights).
it('a standalone line takes a run’s space: its size, its line, its space above and below', async () => {
  const store = await opened(everyCase());
  const standalone = renderRow(cellRow(store.rows(), 'fail'), { storeKey: store.key });
  const run = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  const cell = standalone.container.querySelector('.transcript-cell[data-standalone]')!;
  const group = run.container.querySelector('.transcript-group')!;
  const of = (element: Element, keys: (keyof CSSStyleDeclaration)[]) => keys.map((key) => getComputedStyle(element)[key] || '0px');
  expect(of(cell, ['marginTop', 'marginBottom'])).toEqual(of(group, ['paddingTop', 'paddingBottom']));
  const [line, runLine] = [cell.querySelector('.transcript-cell-line')!, group.querySelector('.transcript-run-line')!];
  expect(of(line, ['fontSize', 'lineHeight'])).toEqual(of(runLine, ['fontSize', 'lineHeight']));
  expect(getComputedStyle(line.querySelector('.transcript-chevron')!).marginLeft || '0px').toBe('0px'); // the chevron after the text, as a run's
});

// The pair review of 2026-11-24: a mark sits in a glyph slot every tool line has, a call's and a run's, marked or not, so
// labels start at one x (a slot's 12 px and the line's 7 px gap: the 19 px a detail is indented by).
// happy-dom computes no pseudo-element, so the slot is read from the stylesheet's rule and the gap from each line drawn.
it('every tool line has a 12 px glyph slot and a 7 px gap, marked or not', async () => {
  const rules = [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  const slot = rules.find((rule) => rule.selectorText.replace(/\s+/g, ' ') === '.transcript-cell-line::before, .transcript-run-line::before')!;
  expect([slot.style.content, slot.style.width, slot.style.flexGrow, slot.style.flexShrink]).toEqual(["''", '12px', '0', '0']); // every line, marked or not
  const ring = rules.find((rule) => rule.selectorText.includes('.transcript-run-line[data-line="running"]::before') && rule.style.margin !== '')!;
  expect(ring.style.margin).toBe('0px 1.5px'); // the 9 px ring centred in the slot
  const store = await opened(everyCase());
  const gapOf = (row: Row) => getComputedStyle(renderRow(row, { storeKey: store.key }).container.querySelector('.transcript-cell-line, .transcript-run-line')!).gap;
  expect([gapOf(cellRow(store.rows(), 'fail')), gapOf(cellRow(store.rows(), 'js')), gapOf(cellRow(store.rows(), 'one')), gapOf(rowOf(store.rows(), 'group'))]).toEqual(['7px', '7px', '7px', '7px']);
});

// The whole transcript and the report view: no tool call draws a box at rest. (An opened run keeps its block of calls,
// which this ticket leaves as it is, a run of one's as any run's.)
describe('no tool call draws a box', () => {
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
  let keys = 0;
  async function mounted(events: SessionEvent[], ownerLane: boolean) {
    const source: TranscriptSource = { key: `quiet-line-${++keys}`, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
    render(<Transcript source={source} variant="session" ownerLane={ownerLane} browserActivity={false} />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
    await act(() => Promise.resolve());
    const { order, ui } = useTranscriptStore.getState().entries[source.key!].state;
    for (const turn of order) if (!ui.expandedTurns.has(turn)) act(() => useTranscriptStore.getState().toggleTurn(source.key!, turn)); // every turn's work in sight, at rest
    return source.key!;
  }
  const standaloneRows = () => [...document.querySelectorAll<HTMLElement>('[data-kind="cell"]')];

  it('in the full transcript', async () => {
    await mounted(everyCase(), false);
    await waitFor(() => expect(standaloneRows()).toHaveLength(5));
    expect(standaloneRows().flatMap(boxed)).toEqual([]);
  });

  it('in the report view, its working record open', async () => {
    await mounted(everyCase(true), true);
    const record = await screen.findByRole('button', { name: /working record/ });
    if (record.getAttribute('aria-expanded') !== 'true') fireEvent.click(record);
    await waitFor(() => expect(standaloneRows().length).toBeGreaterThan(0));
    expect(standaloneRows().flatMap(boxed)).toEqual([]);
  });
});

// The turn line's "N denied" lands on the denied call itself, which takes focus.
it('the denied call is still the jump target, and takes focus; a run of one opens to its call', async () => {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-transcript-scroller') ? 4000 : this.hasAttribute('data-index') ? 40 : 0; },
  });
  try {
    const source: TranscriptSource = { key: 'quiet-line-jump', subscribe: () => () => {}, snapshot: () => Promise.resolve(everyCase()) };
    render(<Transcript source={source} variant="session" browserActivity={false} />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
    const target = cellId.tool(tool('deny'));
    act(() => useTranscriptStore.getState().jumpTo(source.key!, target));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-cell-id')).toBe(target));
    expect(document.activeElement?.hasAttribute('data-standalone')).toBe(true);
    // and a jump to a run of one's call opens its run, as a jump into a run does, and lands on the run's line
    const lone = cellId.tool(tool('one'));
    act(() => useTranscriptStore.getState().jumpTo(source.key!, lone));
    const runLine = () => document.querySelector(`[data-row-id="${lone}"] .transcript-run-line`);
    await waitFor(() => expect(document.activeElement).toBe(runLine()));
    expect(runLine()?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector(`[data-cell-id="${lone}"][data-run-of-one]`)).not.toBeNull();
  } finally {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  }
});

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
import type { JournalRow } from '@shared/wire/journal';
import { loadUxwaveJournal } from '../../../../../../test/support/fixtures';
import { useTranscriptStore } from '../../../stores/transcript';
import { journalToEvents } from '../../dev/journal';
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
    const line = screen.getByRole('button', { name: 'Listed the notes' }); // the call's one line, read as its run
    const call = view.container.querySelector<HTMLElement>(`[data-cell-id="${cellId.tool(tool('one'))}"][data-run-of-one][data-standalone]`)!;
    expect([line.parentElement, line.getAttribute('aria-expanded'), call.dataset.status]).toEqual([call, 'false', 'done']);
    expect(boxed(view.container)).toEqual([]);
    fireEvent.click(line);
    view.rerenderRow(cellRow(store.rows(), 'one'));
    expect(screen.getByRole('button', { name: 'Listed the notes' })).toBe(line); // the same line, open
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(call.querySelector('.transcript-shell-command')?.textContent).toBe('$ ls notes');
    expect(call.textContent).toContain('alpha.txt');
    expect([view.container.querySelectorAll('.transcript-cell-line').length, view.container.querySelector('.transcript-tool-block')]).toEqual([1, null]); // no line of the call's own, no block
    expect(getComputedStyle(call.querySelector('.transcript-cell-detail')!).marginLeft).toBe('19px'); // 19 px in from the text
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

// The pair reviews of 2026-11-24. happy-dom lays nothing out and computes no pseudo-element, so what places a line's text
// and its mark is read from the stylesheet's rules and from each line's computed box.
const px = (value: string) => (value === '' ? 0 : Number.parseFloat(value));
const sheetRules = () => [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
const slotRule = () => sheetRules().find((rule) => rule.selectorText.replace(/\s+/g, ' ') === '.transcript-cell-line::before, .transcript-run-line::before')!;

// (1) One height whether a mark is there or not: every tool line is a block-level flex box (no inline box whose baseline
// a mark or its empty slot could move), of the same 24 px line, with no space above or below of its own.
it('every tool line is one block-level line of one height, with a mark or without', async () => {
  const store = await opened(everyCase());
  const lineOf = (row: Row) => renderRow(row, { storeKey: store.key }).container.querySelector<HTMLElement>('.transcript-cell-line, .transcript-run-line')!;
  const box = (line: HTMLElement) => { const s = getComputedStyle(line); return [s.display, s.lineHeight, px(s.paddingTop), px(s.paddingBottom), px(s.marginTop), px(s.marginBottom)]; };
  const lines = { failed: lineOf(cellRow(store.rows(), 'fail')), denied: lineOf(cellRow(store.rows(), 'deny')), unmarked: lineOf(cellRow(store.rows(), 'js')), image: lineOf(cellRow(store.rows(), 'shot')), runOfOne: lineOf(cellRow(store.rows(), 'one')), run: lineOf(rowOf(store.rows(), 'group')) };
  for (const [name, line] of Object.entries(lines)) expect(box(line), name).toEqual(['flex', '24px', 0, 0, 0, 0]);
});

// (2) Every line's text starts at the prose edge and its mark hangs in the gutter: the line has no inset of its own, and
// its 12 px slot sits wholly left of the text, inside the column's 16 px padding (--measure-pad), the mark right-aligned
// 4 px from the text. In an opened run's block the slot hangs in the line's own 16 px left padding.
it('a tool line’s text starts at the prose edge, its glyph slot hung in the 16 px gutter', async () => {
  const slot = slotRule();
  const [left, width, right] = [px(slot.style.marginLeft), px(slot.style.width), px(slot.style.marginRight)];
  expect([left, width, slot.style.textAlign]).toEqual([-16, 12, 'right']);
  const store = await opened(everyCase());
  const lineOf = (row: Row) => renderRow(row, { storeKey: store.key }).container.querySelector<HTMLElement>('.transcript-cell-line, .transcript-run-line')!;
  for (const line of [lineOf(cellRow(store.rows(), 'fail')), lineOf(cellRow(store.rows(), 'one')), lineOf(rowOf(store.rows(), 'group'))]) {
    const s = getComputedStyle(line);
    expect([px(s.marginLeft), px(s.paddingLeft)]).toEqual([0, 0]); // the line starts at the row's edge, the prose's
    expect(left + width + right + px(s.gap)).toBe(0); // so its text starts there too, the slot all in the gutter
    expect(right + px(s.gap)).toBe(4); // the slot's right edge 4 px from the text
  }
  const ring = sheetRules().find((rule) => rule.selectorText.includes('.transcript-run-line[data-line="running"]::before') && rule.style.marginLeft !== '')!;
  expect(px(ring.style.marginLeft) + 9).toBe(left + width); // the 9 px ring at the slot's right edge
  const block = sheetRules().find((rule) => rule.selectorText === '.transcript-tool-block .transcript-cell-line')!;
  expect(px(block.style.paddingLeft) + left).toBe(8); // an opened run's rows hang theirs in their own padding, 8 px clear of the frame's border
});

// The third pair review: the denied jump's focus ring takes in the hung mark, with the clearance it had round the text.
it('a lone call’s box takes in its glyph’s gutter, so its focus ring rings the mark', async () => {
  const left = px(slotRule().style.marginLeft);
  const store = await opened(everyCase());
  const cell = renderRow(cellRow(store.rows(), 'deny'), { storeKey: store.key }).container.querySelector<HTMLElement>('[data-cell-id]')!;
  const s = getComputedStyle(cell);
  expect([px(s.marginLeft), px(s.paddingLeft)]).toEqual([left, -left]); // the box starts where the slot does; the text stays at the prose edge
  const ring = sheetRules().find((rule) => rule.selectorText.includes('.transcript-cell:focus'))!;
  expect([ring.style.outlineOffset, cell.tabIndex]).toEqual(['4px', -1]); // drawn 4 px outside that box
});

// The third pair review: whatever opens under a line hangs 19 px in from its text: an opened run's blocks as a call's
// detail, a thumbnail and the browser steps do.
it('an opened run’s blocks hang 19 px in from its line’s text, as every opened detail does', async () => {
  const store = await opened(everyCase());
  useTranscriptStore.getState().toggleGroup(store.key, rowOf(store.rows(), 'group').id);
  const run = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  const body = run.container.querySelector<HTMLElement>('.transcript-run-body')!;
  expect(body.querySelector('.transcript-tool-block')).not.toBeNull();
  const image = renderRow(cellRow(store.rows(), 'shot'), { storeKey: store.key }).container.querySelector('.transcript-cell-thumb')!;
  const indent = (element: Element) => getComputedStyle(element).marginLeft;
  expect([indent(body), indent(image)]).toEqual(['19px', '19px']);
  const one = renderRow(cellRow(store.rows(), 'one'), { storeKey: store.key });
  expect(one.container.querySelector('.transcript-run-body')).toBeNull(); // a run of one's body is its call's detail, which hangs so itself
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
it('the denied call is still the jump target, and takes focus; a run of one’s line takes it', async () => {
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
    // and a jump to a run of one's call lands on its one line, as a jump to any lone call does
    const lone = cellId.tool(tool('one'));
    act(() => useTranscriptStore.getState().jumpTo(source.key!, lone));
    const line = () => document.querySelector(`[data-cell-id="${lone}"][data-run-of-one] > .transcript-cell-line`);
    await waitFor(() => expect(document.activeElement).toBe(line()));
  } finally {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  }
});

// The fix wave of 2026-11-24 (the medium review of the branch). Each case failed before its fix.
describe('the fix wave', () => {
  // (1) A call that stands alone while it runs (a non-groupable call follows it in the same message) is drawn as its run
  // of one; when its result fails it is drawn as its own failed line. One disclosure across the change: opened, it stays
  // open, and the button that held the keyboard is the same element, still holding it.
  it('a lone call opened while it runs keeps its detail open and its focus when its result fails', async () => {
    const b = builder('2026-11-20T10:00:00.000Z');
    b.turn('u1', 'Build, then look');
    b.toolUse('mk', 'Bash', { command: 'make', description: 'Build the app' }, 'm1', 0);
    b.toolUse('js', JS, { code: "await page.goto('http://127.0.0.1:17391/')" }, 'm1', 1);
    const store = await opened(b.events);
    const row = () => cellRow(store.rows(), 'mk');
    expect(row().status).toBe('running');
    const view = renderRow(row(), { storeKey: store.key });
    const button = () => view.container.querySelector<HTMLElement>(`[data-cell-id="${cellId.tool(tool('mk'))}"] button[aria-expanded]`)!;
    const first = button();
    fireEvent.click(first);
    view.rerenderRow(row());
    act(() => button().focus());
    expect([button().getAttribute('aria-expanded'), document.activeElement === button()]).toEqual(['true', true]);
    const sent = b.events.length;
    b.result('mk', 'make: *** [all] Error 2', { isError: true });
    act(() => store.push(b.events.slice(sent)));
    expect(row().status).toBe('error');
    view.rerenderRow(row());
    expect(button()).toBe(first); // the same element: the change of presentation remounted nothing
    expect([button().getAttribute('aria-expanded'), document.activeElement === button()]).toEqual(['true', true]);
    expect(view.container.querySelector('.transcript-cell-detail')).not.toBeNull();
  });

  // (3) At the narrowest column the gutter is the column's whole 16 px padding: the denied jump's focus ring is drawn
  // inside the call's box, so it stays in the scrollport, and still takes in the mark.
  it('the denied call’s focus ring is drawn inside its box, within the 16 px gutter, round the mark', async () => {
    const slotLeft = px(slotRule().style.marginLeft);
    const store = await opened(everyCase());
    const cell = renderRow(cellRow(store.rows(), 'deny'), { storeKey: store.key }).container.querySelector<HTMLElement>('[data-cell-id]')!;
    const ring = sheetRules().find((rule) => rule.selectorText.includes('.transcript-cell[data-standalone]:focus'))!;
    const offset = px(ring.style.outlineOffset);
    const width = 1; // the ring's 1 px (`.transcript-cell:focus`'s outline; happy-dom drops a shorthand holding a token)
    expect(style.textContent).toContain('.transcript-cell:focus-visible, .transcript-cell:focus { outline: 1px solid');
    const boxLeft = px(getComputedStyle(cell).marginLeft);
    expect(boxLeft - offset - width).toBeGreaterThanOrEqual(-16); // the ring's outer edge inside the column's padding
    expect(boxLeft - offset).toBeLessThanOrEqual(slotLeft + 2); // its inner edge left of the right-aligned mark
  });

  // (4) A lone call keeps the status cue on its one line: a call the engine moved to the background reads its moved
  // label with its running ring, then none once its task ends; a stopped call with no description reads its stopped label
  // with its stop mark, not the run's count of a stopped step.
  it('a lone call moved to the background keeps its status on its line, running and done', async () => {
    for (const [seq, status] of [[50, 'running'], [204, 'done']] as const) {
      const store = await storeWith(journalToEvents(loadUxwaveJournal('u4p1-a-seeded-1').filter((row: JournalRow) => row.seq <= seq)));
      useTranscriptStore.getState().expandAll(store.key);
      const row = cellRow(store.rows(), 'toolu_01UK719ATPuRjLtWeTEn9rZ1');
      const view = renderRow(row, { storeKey: store.key });
      const cell = view.container.querySelector<HTMLElement>('[data-cell-id]')!;
      expect([cell.dataset.status, cell.querySelector('button')?.textContent]).toEqual([status, expect.stringMatching(/^Moved node wait\.cjs a1 40 to the background after /)]);
      cleanup();
    }
  });

  it('a lone stopped call with no description reads “Stopped a command” with its stop mark', async () => {
    const b = builder('2026-11-20T10:00:00.000Z');
    b.turn('u1', 'Deploy');
    b.toolUse('dep', 'Bash', { command: './deploy.sh production' });
    b.end(['u1'], { isError: true, result: 'error_during_execution', terminalReason: 'aborted_tools' });
    const store = await opened(b.events);
    const row = cellRow(store.rows(), 'dep');
    expect([row.kind, row.status]).toEqual(['cell', 'stopped']);
    const cell = renderRow(row, { storeKey: store.key }).container.querySelector<HTMLElement>('[data-cell-id]')!;
    expect([cell.dataset.status, cell.querySelector('button')?.textContent]).toEqual(['stopped', 'Stopped a command']);
  });

  // (5) Where nothing can point, a closed lone line shows its chevron at rest, as a fact shown on pointing is drawn at
  // rest there (ui/touch-fact.tsx); a pointer screen keeps it hover-only (the owner's ruling).
  it('under (hover: none) a lone line’s chevron shows at rest', () => {
    const media = [...style.sheet!.cssRules].filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText.replace(/\s+/g, '') === '(hover:none)');
    const rules = media.flatMap((rule) => [...rule.cssRules]).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    expect(rules.some((rule) => rule.selectorText.includes('.transcript-cell[data-standalone] > .transcript-cell-line > .transcript-chevron') && rule.style.opacity === '1')).toBe(true);
    const pointer = sheetRules().find((rule) => rule.selectorText === '.transcript-cell-line > .transcript-chevron')!;
    expect(pointer.style.opacity).toBe('0'); // a pointer screen: hover-only
  });
});

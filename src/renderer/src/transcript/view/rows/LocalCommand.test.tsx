// A slash command's output is a light line (UX wave U3b, M1; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-
// rows-find.md, Acceptance 1 and 2, decision 4, Interfaces B): a dim `⎿`, then the output, drawn once (through the
// transcript's markdown, or preformatted for a terminal's text) and clipped at two lines until opened by "Show more".
// The closed and the open state draw the same text. The rows come from the probes' recorded sessions through the live
// route (the journal through the normaliser) and the file's rows (the reader another machine's rows go through). The
// closed bound is the bottom of the second drawn line (ruling R19), read from the line boxes the drawing measures; with
// no layout here the boxes are given as a layout would measure them, and the pixels are the scene's (M6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import type { JsonObject } from 'desk-hub/protocol';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../../../test/support/fixtures';
import { freshSource, subagentLookupOf } from '../../../lane-a/plane-transcript';
import { journalToEvents } from '../../dev/journal';
import { rowsOf, withAllExpanded } from '../../model/derive';
import { applyEvents, createState } from '../../model/reduce';
import type { Row } from '../../model/rows';
import { Disclosures } from '../context';
import { renderRow } from './test-support';

type CommandRow = Extract<Row, { kind: 'local_command' }>;
const SESSION = '0f0e0d0c-0000-4000-8000-00000000c0de';

const commandRows = (events: SessionEvent[]): CommandRow[] =>
  rowsOf(withAllExpanded(applyEvents(createState(null, null), events))).filter((row): row is CommandRow => row.kind === 'local_command');
const live = (name: string) => commandRows(journalToEvents(loadUxwaveJournal(name)));
async function fromFileRows(name: string): Promise<CommandRow[]> {
  const text = readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.transcript.jsonl`), 'utf8');
  const rows = text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject).filter((row) => typeof row.uuid === 'string');
  return commandRows(await freshSource(rows, SESSION, subagentLookupOf([])).snapshot());
}
const starting = (rows: CommandRow[], text: string) => rows.find((row) => row.text.startsWith(text))!;

// The text a layout would measure in an output, as a range measures it (font boxes, 1.5 px under each 18 px line's top
// and 2 px above its bottom, as the Mac run measured them), through the module's own reading of lines: `tall` ones draw
// seven lines, the rest one; `boxes`, when a case gives it, gives the line boxes drawn instead.
const measured = vi.hoisted((): { tall: (element: HTMLElement) => boolean; boxes: (() => { top: number; bottom: number }[]) | null } => ({ tall: () => false, boxes: null }));
vi.mock('./command-bound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./command-bound')>();
  return { ...actual, drawnLineBoxes: (element: HTMLElement) => measured.boxes?.() ?? actual.textLines((measured.tall(element) ? [0, 18, 36, 54, 72, 90, 108] : [0]).map((top) => ({ top: top + 1.5, bottom: top + 16, lineHeight: 18 }))) };
});
function renderedOutputs(tall: (element: HTMLElement) => boolean) {
  measured.tall = tall;
  onTestFinished(() => { measured.tall = () => false; measured.boxes = null; });
}
/** Longer than two lines at the column the scenes use: /cost's seven lines and /context's sixty-one, not a one-line output. */
const longOutput = (element: HTMLElement) => (element.textContent ?? '').length > 100;

afterEach(cleanup);

describe('a command’s output, drawn', () => {
  it('u3-commands-r1, live: a short output is one muted line led by ⎿ under its bubble, with no frame and no “Command output”', () => {
    renderedOutputs(longOutput);
    const rows = live('u3-commands-r1');
    for (const text of ['Reloaded: 0 plugins', 'Session renamed to: uxw renamed']) {
      const { container } = renderRow(starting(rows, text));
      const line = container.querySelector<HTMLElement>('.transcript-command')!;
      expect(line, text).not.toBeNull();
      expect(container.textContent, text).not.toContain('Command output');
      expect(container.querySelector('.transcript-replayed, [data-bubble]'), text).toBeNull();
      expect(line.querySelector('.transcript-command-mark')?.textContent, text).toBe('⎿');
      expect(line.querySelector('.transcript-command-mark')?.getAttribute('aria-hidden'), text).toBe('true');
      expect(line.querySelector('.transcript-command-output')?.textContent, text).toContain(text);
      expect(within(line).queryByRole('button', { name: 'Show more' }), text).toBeNull();
      expect(line.querySelector<HTMLElement>('.transcript-command-output')!.style.getPropertyValue('--command-bound'), text).toBe(''); // one line: no bound
      expect(line.hasAttribute('data-error'), text).toBe(false);
      cleanup();
    }
  });

  it('u3-commands-r1, live: /cost and /context are clipped and offer Show more, which opens onto the same text, then Show less', () => {
    renderedOutputs(longOutput);
    const rows = live('u3-commands-r1');
    for (const text of ['Total cost:', '## Context Usage']) {
      const row = starting(rows, text);
      const { container } = renderRow(row, { disclosures: new Disclosures() });
      const output = container.querySelector<HTMLElement>('.transcript-command-output')!;
      const closed = output.textContent;
      expect(output.hasAttribute('data-open'), text).toBe(false);
      expect(output.hasAttribute('data-collapsed'), text).toBe(true);
      expect(output.style.getPropertyValue('--command-bound'), text).toBe('35.75px'); // the bottom of the second drawn line box (R19): the font box at 34 grown by its 1.75 px half-leading
      const more = within(container).getByRole('button', { name: 'Show more' });
      expect(more.getAttribute('aria-expanded'), text).toBe('false');
      fireEvent.click(more);
      expect(output.hasAttribute('data-open'), text).toBe(true);
      expect(output.textContent, text).toBe(closed); // one drawing, cut when closed
      const less = within(container).getByRole('button', { name: 'Show less' });
      expect(less.getAttribute('aria-expanded'), text).toBe('true');
      fireEvent.click(less);
      expect(output.hasAttribute('data-open'), text).toBe(false);
      expect(output.textContent, text).toBe(closed);
      cleanup();
    }
  });

  it('u3-commands-r1: /context draws its tables as tables and no heading marker, on the live route and from the file', async () => {
    renderedOutputs(longOutput);
    for (const rows of [live('u3-commands-r1'), await fromFileRows('u3-commands-r1')]) {
      const { container } = renderRow(starting(rows, '## Context Usage'));
      const output = container.querySelector<HTMLElement>('.transcript-command-output')!;
      expect(output.querySelector('table')).not.toBeNull();
      expect(output.querySelector('pre')).toBeNull();
      expect(output.textContent).toContain('Context Usage');
      expect(output.textContent).not.toContain('##');
      expect(output.textContent).not.toContain('**');
      cleanup();
    }
  });

  it('u3-terminal-commands-r1: the terminal’s /context grid is preformatted, with no escape sequence in it', async () => {
    renderedOutputs(longOutput);
    const grid = starting(await fromFileRows('u3-terminal-commands-r1'), 'Context Usage');
    expect(grid.plain).toBe(true);
    const { container } = renderRow(grid);
    const pre = container.querySelector<HTMLElement>('.transcript-command-output > pre')!;
    expect(pre).not.toBeNull();
    expect(pre.textContent).toBe(grid.text);
    expect(pre.textContent).not.toContain('\u001b');
    expect(container.querySelector('.transcript-command-output table')).toBeNull();
  });

  it('an error in the error tag is marked as one; the engine’s error sent as ordinary output is not', () => {
    renderedOutputs(longOutput);
    const rows = live('u3-commands-r1');
    const nothing = renderRow(starting(rows, 'Error: No messages to compact'));
    expect(nothing.container.querySelector('.transcript-command')?.hasAttribute('data-error')).toBe(true);
    cleanup();
    const model = renderRow(starting(rows, 'API error: 400'));
    expect(model.container.querySelector('.transcript-command')?.hasAttribute('data-error')).toBe(false);
  });

  // The architect's rulings on the drawn example (the document's Decision Log, R2 and R4)
  // It passed at once: the transcript's markdown already draws each source line break as a break (remark-breaks); kept as R4's guard.
  it('keeps the output’s line ends: the recorded /cost output draws each of its source lines on a line of its own, closed and open (R4)', () => {
    renderedOutputs(longOutput);
    const row = starting(live('u3-commands-r1'), 'Total cost:');
    const source = row.text.split('\n');
    expect(source).toHaveLength(7);
    const { container } = renderRow(row, { disclosures: new Disclosures() });
    const output = container.querySelector<HTMLElement>('.transcript-command-output')!;
    const drawnLines = () => output.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, tr').length + output.querySelectorAll('br').length;
    expect(drawnLines()).toBe(source.length);
    fireEvent.click(within(container).getByRole('button', { name: 'Show more' }));
    expect(drawnLines()).toBe(source.length);
    const words = (output.textContent ?? '').replace(/\s+/g, ' ');
    let from = 0;
    for (const line of source) {
      const at = words.indexOf(line.trim().replace(/\s+/g, ' '), from);
      expect(at, line).toBeGreaterThanOrEqual(from);
      from = at;
    }
  });

  it('sits on the bubble’s side when its text is one line, and is a block of the column when its text has a line end (R2)', () => {
    renderedOutputs(longOutput);
    const rows = live('u3-commands-r1');
    const shape = (row: CommandRow) => {
      const { container } = renderRow(row);
      const block = container.querySelector('.transcript-command')!.hasAttribute('data-block');
      cleanup();
      return block;
    };
    expect(shape(starting(rows, 'Session renamed to: uxw renamed'))).toBe(false);
    expect(shape(starting(rows, 'Error: No messages to compact'))).toBe(false);
    expect(shape(starting(rows, 'Total cost:'))).toBe(true);
    expect(shape(starting(rows, '## Context Usage'))).toBe(true);
    const base: CommandRow = { id: 'local:o2' as CommandRow['id'], turnId: null, at: '2026-11-15T10:00:00.000Z', kind: 'local_command', messageUuid: null, text: 'one line', lone: true, run: { command: 'usage', args: '' } };
    expect(shape(base)).toBe(false); // a lone output follows the same rule
    expect(shape({ ...base, text: 'first line\nsecond line' })).toBe(true);
  });

  it('a line that stands alone names its command first, outside the output, where a run is known', () => {
    renderedOutputs(longOutput);
    const base: CommandRow = { id: 'local:o1' as CommandRow['id'], turnId: null, at: '2026-11-15T10:00:00.000Z', kind: 'local_command', messageUuid: null, text: 'Total cost: $0.01' };
    const named = renderRow({ ...base, lone: true, run: { command: 'usage', args: '' } });
    const line = named.container.querySelector<HTMLElement>('.transcript-command')!;
    expect(line.querySelector('.transcript-command-name')?.textContent).toBe('/usage · ');
    expect(line.querySelector('.transcript-command-output')?.textContent).toBe('Total cost: $0.01');
    expect(line.textContent).toBe('⎿/usage · Total cost: $0.01');
    cleanup();
    const unnamed = renderRow({ ...base, lone: true });
    expect(unnamed.container.querySelector('.transcript-command-name')).toBeNull();
    cleanup();
    const underBubble = renderRow({ ...base, run: { command: 'usage', args: '' } });
    expect(underBubble.container.querySelector('.transcript-command-name')).toBeNull();
  });
  // The branch panel's finding 3 (ruled 2026-11-15 (UTC)): closed, an output is never drawn taller than its bound,
  // whatever it holds and whenever its content finishes loading; the measure runs again on any change of its size,
  // height included. An output that draws no text line (an image) grows after mount, at the same width.
  it('an output whose drawing grows after mount is measured again and bounded at two lines of its type, with Show more', () => {
    renderedOutputs(() => false);
    measured.boxes = () => []; // an image: no text line to measure
    const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      private readonly entry: { callback: ResizeObserverCallback; targets: Element[] };
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: [] };
        observers.push(this.entry);
      }
      observe(target: Element) { this.entry.targets.push(target); }
      unobserve() {}
      disconnect() { this.entry.targets.length = 0; }
    });
    let height = 0; // the image not yet loaded
    const isOutput = (element: Element) => element instanceof HTMLElement && element.classList.contains('transcript-command-output');
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return isOutput(this) ? height : 0; });
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => (isOutput(element) ? ({ lineHeight: '18px', fontSize: '12px' } as CSSStyleDeclaration) : computed(element, pseudo)));
    onTestFinished(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    const row: CommandRow = { id: 'local:o-chart' as CommandRow['id'], turnId: null, at: '2026-11-15T10:00:00.000Z', kind: 'local_command', messageUuid: null, text: '![Usage by day](data:image/png;base64,iVBORw0KGgo=)' };
    const { container } = renderRow(row, { disclosures: new Disclosures() });
    const output = container.querySelector<HTMLElement>('.transcript-command-output')!;
    expect(within(container).queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(output.style.getPropertyValue('--command-bound')).toBe('');

    height = 240; // the image has loaded: taller, at the same width
    act(() => { for (const { callback, targets } of observers) if (targets.length > 0) callback(targets.map((target) => ({ target }) as ResizeObserverEntry), {} as ResizeObserver); });
    expect(within(container).getByRole('button', { name: 'Show more' })).toBeTruthy();
    expect(output.style.getPropertyValue('--command-bound')).toBe('36px');
    expect(output.hasAttribute('data-collapsed')).toBe(true);
  });
});

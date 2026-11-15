// A slash command's output is a light line (UX wave U3b, M1; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-
// rows-find.md, Acceptance 1 and 2, decision 4, Interfaces B): a dim `⎿`, then the output, drawn once (through the
// transcript's markdown, or preformatted for a terminal's text) and clipped at two lines until opened by "Show more".
// The closed and the open state draw the same text. The rows come from the probes' recorded sessions through the live
// route (the journal through the normaliser) and the file's rows (the reader another machine's rows go through); that
// the bound is two lines of the row's type is the scene's (M6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, within } from '@testing-library/react';
import type { JsonObject } from 'desk-hub/protocol';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
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

/** The output's drawn height, as layout would give it: `tall` rows overflow two lines, the rest fit. */
function renderedOutputs(tall: (element: HTMLElement) => boolean) {
  const output = (element: HTMLElement) => element.classList.contains('transcript-command-output');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return output(this) ? (tall(this) ? 400 : 18) : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return output(this) ? (this.hasAttribute('data-open') || !tall(this) ? this.scrollHeight : 36) : 0; },
  });
  onTestFinished(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  });
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
});

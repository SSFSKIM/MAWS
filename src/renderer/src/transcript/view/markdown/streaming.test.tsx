// A table streaming in is held back until its delimiter row has completed, so its header never shows as pipe text.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';
import { holdBackTable } from './streaming';

const LEAD = 'Results:\n\n';

describe('holdBackTable', () => {
  it('holds a trailing header, and a header with its delimiter row still arriving', () => {
    for (const tail of ['|', '| Row | Hei', '| Row | Height |', '| Row | Height |\n', '| Row | Height |\n| --', '| Row | Height |\n| --- | --- |']) {
      expect(holdBackTable(LEAD + tail), JSON.stringify(tail)).toBe(LEAD.trimEnd() + '\n');
    }
  });

  it('releases the table once a line follows its delimiter row', () => {
    for (const tail of ['| Row | Height |\n| --- | --- |\n', '| Row | Height |\n| --- | --- |\n| 1 | 2', '| a |\n|:-:|\n']) expect(holdBackTable(LEAD + tail)).toBe(LEAD + tail);
  });

  it('leaves text alone: no pipe line at the end, pipe lines that are no table, a pipe line inside a code fence', () => {
    for (const text of ['Plain text.', '| not | a table |\n| still text |', 'Code:\n\n```\n| a | b |', 'Done.\n']) expect(holdBackTable(text)).toBe(text);
    expect(holdBackTable('```\nx\n```\n| a |')).toBe('```\nx\n```');
  });
});

describe('a streaming table in the rendered answer', () => {
  it('shows no raw header while the table is arriving, then the table', () => {
    const view = render(<Markdown markdown={`${LEAD}| Row | Height |\n| --- | -`} live />);
    expect(view.container.textContent).not.toContain('|');
    expect(view.container.textContent).not.toContain('Row');
    view.rerender(<Markdown markdown={`${LEAD}| Row | Height |\n| --- | --- |\n| 1 | 2`} live />);
    expect(view.container.querySelector('table')).not.toBeNull();
    expect(view.container.querySelector('th')?.textContent).toBe('Row');
  });

  it('renders completed text whole: a finished block is never held', () => {
    const view = render(<Markdown markdown={`${LEAD}| Row | Height |`} live={false} />);
    expect(view.container.textContent).toContain('| Row | Height |');
  });
});

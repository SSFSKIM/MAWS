// Cells and cell detail (C6 M4): the collapsed line, the disclosure through the store, each detail variant with the
// mockup's actions, and the safeguard verdict, which appears in detail only (§19), never on the line.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadJournal } from '../../../../../../test/support/fixtures';
import { useTranscriptStore } from '../../../stores/transcript';
import { journalToEvents } from '../../dev/journal';
import { cellId } from '../../model/keys';
import type { Cell, Row } from '../../model/rows';
import { BASH_RESULT, builder, tool, type Builder } from '../../model/test-events';
import { renderRow, storeWith } from '../rows/test-support';

afterEach(cleanup);

const cellsOf = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
const rowHolding = (rows: Row[], id: string) => rows.find((row) => row.id === id || (row.kind === 'group' && row.cells.some((cell) => cell.id === id)))!;

// One closed turn from `build`, every turn and group expanded and the named cell's detail open; renders the row that
// holds that cell.
async function expandedCell(build: (b: Builder) => void, id: string) {
  const b = builder();
  b.turn('u1');
  build(b);
  b.end(['u1']);
  const store = await storeWith(b.events);
  const state = useTranscriptStore.getState();
  state.expandAll(store.key);
  state.toggleCell(store.key, id as Cell['id']);
  const row = rowHolding(store.rows(), id);
  const view = renderRow(row, { storeKey: store.key });
  const cell = view.container.querySelector<HTMLElement>(`[data-cell-id="${id}"]`)!;
  return { ...view, store, cell, line: cell.querySelector('button')! };
}

describe('cell line', () => {
  it('shows the label with code spans, and its disclosure opens and closes the detail through the store', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'pnpm test' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.end(['u1']);
    const store = await storeWith(b.events);
    useTranscriptStore.getState().expandAll(store.key);
    const row = store.rows().find((r) => r.kind === 'cell')!;
    const view = renderRow(row, { storeKey: store.key });
    const line = screen.getByRole('button', { expanded: false });
    expect(line.textContent).toMatch(/^Ran pnpm test in /);
    expect(line.querySelector('code')?.textContent).toBe('pnpm test');
    fireEvent.click(line);
    view.rerenderRow(store.rows().find((r) => r.kind === 'cell')!);
    expect(screen.getByRole('button', { expanded: true })).toBe(line);
    expect(view.container.querySelector('[data-cell-id][data-expanded]')).not.toBeNull();
  });
});

describe('shell detail', () => {
  it('shows the command, cwd, output and exit footer, with the three copy actions', async () => {
    const { cell } = await expandedCell((b) => {
      b.toolUse('t1', 'Bash', { command: 'bun test src/sidebar', cwd: '/w/sidebar-drag' });
      b.tick(3200);
      b.result('t1', ' 18 pass\n  0 fail', { structured: BASH_RESULT(' 18 pass\n  0 fail') });
    }, 'cell:t1');
    const detail = within(cell);
    expect(detail.getByText('$ bun test src/sidebar')).toBeDefined();
    expect(cell.textContent).toContain('/w/sidebar-drag');
    expect(cell.querySelector('pre')?.textContent).toContain('18 pass');
    expect(cell.textContent).toContain('✓ Exit code 0 · 3s');
    for (const name of ['Copy command', 'Copy output', 'Copy all']) expect(detail.getByRole('button', { name })).toBeDefined();
    expect(detail.queryByRole('button', { name: 'Open full log' })).toBeNull(); // nothing was cut
  });

  it('a failing command reads its exit code, and output over 64 KB shows its head, tail and the omitted marker, with Open full log', async () => {
    const big = `${'a'.repeat(40 * 1024)}MIDDLE${'z'.repeat(40 * 1024)}`;
    const { cell, actions } = await expandedCell((b) => {
      b.toolUse('t1', 'Bash', { command: 'make' });
      b.result('t1', `Exit code 2\n${big}`, { isError: true });
    }, 'cell:t1');
    expect(cell.textContent).toContain('✕ Exit code 2');
    const output = cell.querySelector('pre')!.textContent!;
    expect(output).not.toContain('MIDDLE');
    expect(output).toMatch(/\d+ KB omitted/);
    fireEvent.click(within(cell).getByRole('button', { name: 'Open full log' }));
    expect(actions.openFullLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'cell:t1' }));
  });
});

describe('edit detail', () => {
  it('renders the hunks as diff lines with line numbers and add and del lines, and the path opens the file', async () => {
    const hunk = { oldStart: 42, oldLines: 2, newStart: 42, newLines: 3, lines: [' const rect = row.getBoundingClientRect();', '-setTarget(id);', '+const edge = y < mid;', '+setTarget({ id, edge });', 'return;'] }; // the last line unprefixed (seen in a synthetic journal): context, whole
    const { cell, actions } = await expandedCell((b) => {
      b.toolUse('t1', 'Edit', { file_path: '/p/src/drag.ts', old_string: 'setTarget(id);', new_string: 'x' });
      b.result('t1', 'ok', { structured: { filePath: '/p/src/drag.ts', structuredPatch: [hunk] } });
      b.toolUse('t2', 'Bash', { command: 'ls' });
      b.result('t2', 'a', { structured: BASH_RESULT('a') });
    }, 'cell:t1');
    const lines = [...cell.querySelectorAll<HTMLElement>('[data-diff]')];
    expect(lines.map((line) => line.dataset.diff)).toEqual(['context', 'del', 'add', 'add', 'context']);
    expect(lines.map((line) => line.querySelector('[data-line-number]')?.textContent)).toEqual(['42', '43', '43', '44', '45']);
    expect(lines[4].textContent).toContain('return;');
    expect(lines[1].textContent).toContain('setTarget(id);');
    fireEvent.click(within(cell).getByRole('button', { name: 'drag.ts' }));
    expect(actions.openFile).toHaveBeenCalledWith('/p/src/drag.ts', 42);
  });
});

describe('read detail', () => {
  it('lists path chips that open the file at the first line of its range', async () => {
    const { cell, actions } = await expandedCell((b) => {
      b.toolUse('t1', 'Read', { file_path: '/p/a.ts', offset: 10, limit: 5 });
      b.result('t1', '10\tconst a = 1;');
      b.toolUse('t2', 'Read', { file_path: '/p/b.ts' });
      b.result('t2', '1\tconst b = 2;');
      b.toolUse('t3', 'Bash', { command: 'ls' });
      b.result('t3', 'a', { structured: BASH_RESULT('a') });
    }, cellId.reads(tool('t1')));
    const chips = within(cell).getAllByRole('button', { name: /\.ts/ });
    expect(chips.map((chip) => chip.textContent)).toEqual(['a.ts:10–14', 'b.ts']);
    fireEvent.click(chips[0]);
    expect(actions.openFile).toHaveBeenCalledWith('/p/a.ts', 10);
    fireEvent.click(chips[1]);
    expect(actions.openFile).toHaveBeenLastCalledWith('/p/b.ts', undefined);
  });
});

describe('search and web detail', () => {
  it('a search shows its output; a fetch links its URL through openExternal', async () => {
    const search = await expandedCell((b) => {
      b.toolUse('t1', 'Grep', { pattern: 'onDragStart', path: 'src' });
      b.result('t1', 'src/a.ts:3: onDragStart');
      b.toolUse('t2', 'WebFetch', { url: 'https://tanstack.com/virtual', prompt: 'x' });
      b.result('t2', 'TanStack Virtual docs');
    }, 'cell:t1');
    expect(search.cell.querySelector('pre')?.textContent).toContain('src/a.ts:3: onDragStart');
    cleanup();
    const web = await expandedCell((b) => {
      b.toolUse('t1', 'Grep', { pattern: 'x' });
      b.result('t1', 'none');
      b.toolUse('t2', 'WebFetch', { url: 'https://tanstack.com/virtual', prompt: 'x' });
      b.result('t2', 'TanStack Virtual docs');
    }, 'cell:t2');
    expect(web.cell.textContent).toContain('TanStack Virtual docs');
    fireEvent.click(within(web.cell).getByRole('button', { name: 'https://tanstack.com/virtual' }));
    expect(web.actions.openExternal).toHaveBeenCalledWith('https://tanstack.com/virtual');
  });
});

describe('mcp detail', () => {
  it('renders text blocks as markdown, and Raw shows the JSON', async () => {
    const { cell } = await expandedCell((b) => {
      b.toolUse('t1', 'mcp__docs__search', { query: 'virtual' });
      b.result('t1', [{ type: 'text', text: 'Found **two** pages' }]);
      b.toolUse('t2', 'Bash', { command: 'ls' });
      b.result('t2', 'a', { structured: BASH_RESULT('a') });
    }, 'cell:t1');
    expect(cell.querySelector('[data-streamdown="strong"]')?.textContent).toBe('two');
    const raw = within(cell).getByRole('button', { name: 'Raw' });
    expect(raw.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(raw);
    expect(raw.getAttribute('aria-pressed')).toBe('true');
    expect(cell.querySelector('pre')?.textContent).toContain('"query": "virtual"');
    expect(cell.querySelector('[data-streamdown="strong"]')).toBeNull();
  });
});

describe('image, thinking, hook and generic detail', () => {
  it('an image result renders inline from its data URL', async () => {
    const { cell } = await expandedCell((b) => {
      b.toolUse('t1', 'Read', { file_path: '/p/shot.png' });
      b.result('t1', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }]);
    }, 'cell:t1');
    expect(cell.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('a hook shows its event, name, outcome and output; a generic tool its input and result', async () => {
    const hook = await expandedCell((b) => {
      b.toolUse('t1', 'Bash', { command: 'ls' });
      b.result('t1', 'a', { structured: BASH_RESULT('a') });
      b.emit('hook.started', { hookId: 'h1', hookName: 'PostToolUse:Bash', hookEvent: 'PostToolUse' });
      b.emit('hook.finished', { hookId: 'h1', hookName: 'PostToolUse:Bash', hookEvent: 'PostToolUse', outcome: 'success', exitCode: 0, stdout: 'hook said hi', stderr: '' });
    }, 'cell:hook:h1');
    expect(hook.cell.textContent).toContain('hook said hi');
    expect(hook.cell.textContent).toContain('exit 0');
    cleanup();
    const generic = await expandedCell((b) => {
      b.toolUse('t1', 'LSP', { operation: 'hover', file: '/p/a.ts' });
      b.result('t1', 'type A = string');
      b.toolUse('t2', 'Bash', { command: 'ls' });
      b.result('t2', 'a', { structured: BASH_RESULT('a') });
    }, 'cell:t1');
    expect(generic.cell.textContent).toContain('"operation": "hover"');
    expect(generic.cell.textContent).toContain('type A = string');
  });

  it('a thinking cell inside a group discloses its text', async () => {
    const { cell } = await expandedCell((b) => {
      b.thinking('m1', 0, 'Look at the drag handler first.');
      b.toolUse('t1', 'Bash', { command: 'ls' }, 'm1', 1);
      b.result('t1', 'a', { structured: BASH_RESULT('a') });
      b.toolUse('t2', 'Bash', { command: 'pwd' });
      b.result('t2', '/', { structured: BASH_RESULT('/') });
    }, 'cell:think:m1:0');
    expect(cell.textContent).toContain('Look at the drag handler first.');
  });
});

describe('the 64 KB DOM cap on every detail output branch', () => {
  const BIG = `${'a'.repeat(40 * 1024)}MIDDLE${'z'.repeat(40 * 1024)}`;
  const capped = (element: Element) => {
    expect(element.textContent).not.toContain('MIDDLE');
    expect(element.textContent).toMatch(/\d+ KB omitted/);
  };
  const withLs = (b: Builder) => {
    b.toolUse('t9', 'Bash', { command: 'ls' });
    b.result('t9', 'a', { structured: BASH_RESULT('a') });
  };

  it('shell stderr, with Open full log as the route to the rest', async () => {
    const { cell, actions } = await expandedCell((b) => {
      b.toolUse('t1', 'Bash', { command: 'make' });
      b.result('t1', 'x', { structured: { ...BASH_RESULT('ok'), stderr: BIG } });
      withLs(b);
    }, 'cell:t1');
    capped(cell);
    fireEvent.click(within(cell).getByRole('button', { name: 'Open full log' }));
    expect(actions.openFullLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'cell:t1' }));
  });

  it('MCP blocks whose aggregate exceeds the cap render until the budget is spent, then one marker and Open full log', async () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({ type: 'text', text: `BLOCK${i} ${'x'.repeat(10 * 1024)}` }));
    const { cell, actions } = await expandedCell((b) => {
      b.toolUse('t1', 'mcp__docs__search', { query: 'q' });
      b.result('t1', blocks);
      withLs(b);
    }, 'cell:t1');
    const text = cell.textContent ?? '';
    expect(text).toContain('BLOCK0');
    expect(text).not.toContain('BLOCK11');
    expect(text.length).toBeLessThan(80 * 1024);
    expect(cell.querySelectorAll('[data-omitted]')).toHaveLength(1);
    expect(text).toMatch(/\d+ KB omitted/);
    fireEvent.click(within(cell).getByRole('button', { name: 'Open full log' }));
    expect(actions.openFullLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'cell:t1' }));
  });

  it('an oversized structuredPatch renders hunks until the budget is spent, then N lines omitted and Open full log', async () => {
    const lines = Array.from({ length: 4000 }, (_, i) => `+const line${i} = ${'y'.repeat(30)};`);
    const hunk = { oldStart: 1, oldLines: 0, newStart: 1, newLines: lines.length, lines };
    const { cell, actions } = await expandedCell((b) => {
      b.toolUse('t1', 'Write', { file_path: '/p/big.ts', content: 'x' });
      b.result('t1', 'ok', { structured: { type: 'create', filePath: '/p/big.ts', structuredPatch: [hunk], originalFile: null } });
      withLs(b);
    }, 'cell:t1');
    const rendered = cell.querySelectorAll('[data-diff]').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(lines.length);
    expect(cell.querySelector('[data-omitted]')?.textContent).toContain(`${lines.length - rendered} lines omitted`);
    fireEvent.click(within(cell).getByRole('button', { name: 'Open full log' }));
    expect(actions.openFullLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'cell:t1' }));
  });

  it('MCP text blocks and a string result', async () => {
    for (const content of [[{ type: 'text', text: BIG }], BIG] as const) {
      const { cell } = await expandedCell((b) => {
        b.toolUse('t1', 'mcp__docs__search', { query: 'q' });
        b.result('t1', content as never);
        withLs(b);
      }, 'cell:t1');
      capped(cell);
      cleanup();
    }
  });

  it('hook stdout and stderr', async () => {
    for (const [stdout, stderr] of [[BIG, ''], ['', BIG]]) {
      const { cell } = await expandedCell((b) => {
        withLs(b);
        b.emit('hook.started', { hookId: 'h1', hookName: 'PostToolUse:Bash', hookEvent: 'PostToolUse' });
        b.emit('hook.finished', { hookId: 'h1', hookName: 'PostToolUse:Bash', hookEvent: 'PostToolUse', outcome: 'success', exitCode: 0, stdout, stderr });
      }, 'cell:hook:h1');
      capped(cell);
      cleanup();
    }
  });
});

describe('safeguard verdict (§19)', () => {
  it('pass2/auto-classifier: the detail shows the auto-mode line and no cell line contains the word auto', async () => {
    const store = await storeWith(journalToEvents(loadJournal('pass2', 'auto-classifier')));
    const state = useTranscriptStore.getState();
    state.expandAll(store.key);
    const cells = cellsOf(store.rows());
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) state.toggleCell(store.key, cell.id);
    for (const row of store.rows().filter((r) => r.kind === 'cell' || r.kind === 'group')) {
      const view = renderRow(row, { storeKey: store.key });
      for (const element of view.container.querySelectorAll<HTMLElement>('[data-cell-id]')) {
        const line = element.querySelector('button')!;
        expect(line.textContent).not.toMatch(/auto/i);
        if (element.dataset.cellId!.startsWith('cell:toolu_')) expect(element.textContent).toContain('Auto mode · reviewed · not flagged');
      }
      view.unmount();
    }
  });

  it('a flagged verdict reads flagged; an unreviewed call reads not reviewed only in a turn auto mode reviewed', async () => {
    const reviewed = (b: Builder) => {
      b.toolUse('t1', 'Bash', { command: 'curl x' });
      b.result('t1', 'ok', { structured: BASH_RESULT('ok'), safeguard: 'flagged' });
      b.toolUse('t2', 'Bash', { command: 'ls' });
      b.result('t2', 'a', { structured: BASH_RESULT('a') });
    };
    const flagged = await expandedCell(reviewed, 'cell:t1');
    expect(flagged.cell.textContent).toContain('Auto mode · flagged');
    expect(flagged.line.textContent).not.toMatch(/auto|flag/i);
    cleanup();
    const unreviewed = await expandedCell(reviewed, 'cell:t2');
    expect(unreviewed.cell.textContent).toContain('Auto mode · not reviewed');
    cleanup();
    const plain = await expandedCell((b) => {
      b.toolUse('t1', 'Bash', { command: 'ls' });
      b.result('t1', 'a', { structured: BASH_RESULT('a') });
      b.toolUse('t2', 'Bash', { command: 'pwd' });
      b.result('t2', '/', { structured: BASH_RESULT('/') });
    }, 'cell:t1');
    expect(plain.cell.textContent).not.toMatch(/auto mode/i);
  });
});

// The proposed change of a file prompt (UX wave U1a, §I): what `proposedChange` answers for each tool and what it read of
// the file, by §I's table, and the hunks it builds (three lines of context, the engine's structuredPatch shape).
import { describe, expect, it } from 'vitest';
import { proposedChange, proposedFilePath } from './proposed';

// A file of twenty numbered lines, ending in a newline.
const TWENTY = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const text = (t: string) => ({ text: t });
const edit = (old_string: string, new_string: string, more: object = {}) => ({ file_path: '/w/src/list.txt', old_string, new_string, ...more });

describe('an Edit', () => {
  it('replaces the first occurrence of old_string and shows it with three lines of context on each side', () => {
    expect(proposedChange('Edit', edit('line 10\n', 'line ten\n'), text(TWENTY))).toEqual({
      kind: 'diff',
      change: 'update',
      hunks: [{ oldStart: 7, oldLines: 7, newStart: 7, newLines: 7, lines: [' line 7', ' line 8', ' line 9', '-line 10', '+line ten', ' line 11', ' line 12', ' line 13'] }],
    });
  });

  it('keeps the context inside the file at its head and at its end', () => {
    expect(proposedChange('Edit', edit('line 1\n', 'first\n'), text(TWENTY))).toEqual({
      kind: 'diff',
      change: 'update',
      hunks: [{ oldStart: 1, oldLines: 4, newStart: 1, newLines: 4, lines: ['-line 1', '+first', ' line 2', ' line 3', ' line 4'] }],
    });
    expect(proposedChange('Edit', edit('line 20', 'last'), text(TWENTY))).toEqual({
      kind: 'diff',
      change: 'update',
      hunks: [{ oldStart: 17, oldLines: 4, newStart: 17, newLines: 4, lines: [' line 17', ' line 18', ' line 19', '-line 20', '+last'] }],
    });
  });

  it('replaces only the first occurrence without replace_all, and every one with it', () => {
    const twice = TWENTY.replace('line 2\n', 'same\n').replace('line 15\n', 'same\n');
    const once = proposedChange('Edit', edit('same', 'other'), text(twice));
    expect(once.kind === 'diff' && once.hunks.map((h) => h.lines.filter((l) => l[0] === '+'))).toEqual([['+other']]);
    expect(once.kind === 'diff' && once.hunks[0]!.oldStart).toBe(1);
    const all = proposedChange('Edit', edit('same', 'other', { replace_all: true }), text(twice));
    expect(all.kind === 'diff' && all.hunks.map((h) => [h.oldStart, h.lines.filter((l) => l[0] === '+')])).toEqual([
      [1, ['+other']],
      [12, ['+other']],
    ]);
  });

  it('joins two changes whose context touches into one hunk', () => {
    const near = proposedChange('Edit', edit('line 5\nline 6\nline 7\nline 8\nline 9\nline 10\nline 11\n', 'five\nline 6\nline 7\nline 8\nline 9\nline 10\neleven\n'), text(TWENTY));
    expect(near.kind === 'diff' && near.hunks.map((h) => [h.oldStart, h.oldLines, h.newLines])).toEqual([[2, 13, 13]]);
  });

  it('answers the input alone when the file does not hold old_string, when old_string is empty, and when the file was not read', () => {
    expect(proposedChange('Edit', edit('not in the file', 'x'), text(TWENTY))).toEqual({ kind: 'input' });
    expect(proposedChange('Edit', edit('', 'x'), text(TWENTY))).toEqual({ kind: 'input' });
    expect(proposedChange('Edit', edit('line 1', 'x'), null)).toEqual({ kind: 'input' });
    expect(proposedChange('Edit', edit('line 1', 'x'), 'missing')).toEqual({ kind: 'input' });
    expect(proposedChange('Edit', { file_path: '/w/a.txt', old_string: 'line 1' }, text(TWENTY))).toEqual({ kind: 'input' }); // no new_string
  });
});

describe('a MultiEdit', () => {
  it('applies its edits in order, each to what the one before left', () => {
    const input = { file_path: '/w/src/list.txt', edits: [{ old_string: 'line 3\n', new_string: 'three\n' }, { old_string: 'three', new_string: 'THREE' }] };
    expect(proposedChange('MultiEdit', input, text(TWENTY))).toEqual({
      kind: 'diff',
      change: 'update',
      hunks: [{ oldStart: 1, oldLines: 6, newStart: 1, newLines: 6, lines: [' line 1', ' line 2', '-line 3', '+THREE', ' line 4', ' line 5', ' line 6'] }],
    });
  });

  it('answers the input alone as soon as one edit is not found', () => {
    const input = { file_path: '/w/src/list.txt', edits: [{ old_string: 'line 3', new_string: 'three' }, { old_string: 'line 3', new_string: 'again' }] };
    expect(proposedChange('MultiEdit', input, text(TWENTY))).toEqual({ kind: 'input' });
    expect(proposedChange('MultiEdit', { file_path: '/w/src/list.txt', edits: [] }, text(TWENTY))).toEqual({ kind: 'input' });
  });
});

describe('a Write', () => {
  it('over an existing file is a line diff, not the whole file replaced', () => {
    expect(proposedChange('Write', { file_path: '/w/a.txt', content: 'a\nB\nc\nd\n' }, text('a\nb\nc\n'))).toEqual({
      kind: 'diff',
      change: 'update',
      hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' a', '-b', '+B', ' c', '+d'] }],
    });
  });

  it('of a missing file is one hunk of added lines', () => {
    expect(proposedChange('Write', { file_path: '/w/new.txt', content: 'first\nsecond\n' }, 'missing')).toEqual({
      kind: 'diff',
      change: 'create',
      hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, lines: ['+first', '+second'] }],
    });
    expect(proposedChange('Write', { file_path: '/w/empty.txt', content: '' }, 'missing')).toEqual({ kind: 'diff', change: 'create', hunks: [] });
  });

  it('says where a last line gains or loses its newline', () => {
    expect(proposedChange('Write', { file_path: '/w/a.txt', content: 'a\nb\n' }, text('a\nb'))).toEqual({
      kind: 'diff',
      change: 'update',
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '\\ No newline at end of file', '+b'] }],
    });
  });

  it('answers the input alone when the file was not read, or the input holds no content', () => {
    expect(proposedChange('Write', { file_path: '/w/a.txt', content: 'x' }, null)).toEqual({ kind: 'input' });
    expect(proposedChange('Write', { file_path: '/w/a.txt' }, text('x'))).toEqual({ kind: 'input' });
  });

  it('replaces the changed region whole when the two texts differ past the diff’s bound', () => {
    const before = Array.from({ length: 1500 }, (_, i) => `old ${i}`).join('\n') + '\n';
    const after = Array.from({ length: 1500 }, (_, i) => `new ${i}`).join('\n') + '\n';
    const started = performance.now();
    const answer = proposedChange('Write', { file_path: '/w/a.txt', content: `head\n${after}` }, text(`head\n${before}`));
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(answer.kind === 'diff' && answer.hunks.length).toBe(1);
    const lines = answer.kind === 'diff' ? answer.hunks[0]!.lines : [];
    expect(lines[0]).toBe(' head');
    expect(lines.slice(1, 1501).every((l) => l.startsWith('-old '))).toBe(true);
    expect(lines.slice(1501).every((l) => l.startsWith('+new '))).toBe(true);
    expect(lines).toHaveLength(3001);
  });
});

describe('a NotebookEdit, and the file a prompt reads', () => {
  it('a notebook edit is the input alone, whatever was read', () => {
    expect(proposedChange('NotebookEdit', { notebook_path: '/w/n.ipynb', new_source: 'x' }, text('{}'))).toEqual({ kind: 'input' });
  });

  it('reads the one file an Edit, a MultiEdit or a Write names, and nothing for any other prompt', () => {
    expect(proposedFilePath('Edit', edit('a', 'b'))).toBe('/w/src/list.txt');
    expect(proposedFilePath('Write', { file_path: '/w/a.txt', content: '' })).toBe('/w/a.txt');
    expect(proposedFilePath('MultiEdit', { file_path: '/w/a.txt', edits: [{ old_string: 'a', new_string: 'b' }] })).toBe('/w/a.txt');
    expect(proposedFilePath('MultiEdit', { file_path: '/w/a.txt', edits: [{ file_path: '/w/b.txt', old_string: 'a', new_string: 'b' }] })).toBeNull(); // several files
    expect(proposedFilePath('NotebookEdit', { notebook_path: '/w/n.ipynb', new_source: 'x' })).toBeNull();
    expect(proposedFilePath('Bash', { command: 'ls' })).toBeNull();
    expect(proposedFilePath('Edit', { old_string: 'a', new_string: 'b' })).toBeNull();
  });
});

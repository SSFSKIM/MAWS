// Conflict blocks (E5 execution document, Interfaces *Conflict blocks*; M3's pins): git's markers found in a document by
// the marker grammar, and a block replaced by the chosen side.
import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { findConflicts, resolve, type ConflictBlock } from './conflicts';

const doc = (...lines: string[]) => Text.of(lines);
// A section's lines as the document holds them.
const slice = (text: Text, range: { from: number; to: number } | null) => (range ? text.sliceString(range.from, range.to) : null);

const DIFF3 = ['before', '<<<<<<< HEAD', 'mine 1', 'mine 2', '||||||| base', 'base 1', '=======', 'theirs 1', '>>>>>>> feature', 'after'];

describe('conflict blocks', () => {
  const views: EditorView[] = [];
  afterEach(() => views.splice(0).forEach((view) => view.destroy()));
  const viewOf = (text: string) => {
    const view = new EditorView({ state: EditorState.create({ doc: text }) });
    views.push(view);
    return view;
  };

  it('finds a balanced block with a base: its sections, its labels and its extent', () => {
    const text = doc(...DIFF3);
    const blocks = findConflicts(text);
    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block.mine.label).toBe('HEAD');
    expect(block.theirs.label).toBe('feature');
    expect(slice(text, block.mine)).toBe('mine 1\nmine 2\n');
    expect(slice(text, block.base)).toBe('base 1\n');
    expect(slice(text, block.theirs)).toBe('theirs 1\n');
    expect(block.from).toBe(text.line(2).from);
    expect(block.to).toBe(text.line(10).from); // the `>>>>>>>` line with its newline
  });

  it('answers base null for a block without `|||||||`, and labels null for bare markers', () => {
    const text = doc('<<<<<<<', 'a', '=======', 'b', '>>>>>>>');
    const [block] = findConflicts(text);
    expect(block.base).toBeNull();
    expect(block.mine.label).toBeNull();
    expect(block.theirs.label).toBeNull();
    expect(slice(text, block.mine)).toBe('a\n');
    expect(slice(text, block.theirs)).toBe('b\n');
    expect(block.to).toBe(text.length); // the last line has no newline
  });

  it('finds none for `<<<<<<<` with no `>>>>>>>`', () => {
    expect(findConflicts(doc('<<<<<<< HEAD', 'a', '=======', 'b'))).toEqual([]);
  });

  it('finds two blocks in order', () => {
    const text = doc('<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> one', 'between', '<<<<<<< HEAD', 'c', '=======', 'd', '>>>>>>> two');
    const blocks = findConflicts(text);
    expect(blocks.map((block) => block.theirs.label)).toEqual(['one', 'two']);
    expect(blocks[0].to).toBeLessThan(blocks[1].from);
    expect(slice(text, blocks[1].mine)).toBe('c\n');
  });

  it('leaves alone a run whose markers come out of order, and lines that only look like markers', () => {
    expect(findConflicts(doc('<<<<<<< HEAD', 'a', '>>>>>>> feature'))).toEqual([]); // no `=======`
    expect(findConflicts(doc('<<<<<<< HEAD', 'a', '=======', '||||||| base', 'b', '>>>>>>> feature'))).toEqual([]); // base after the separator
    expect(findConflicts(doc('<<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> feature'))).toEqual([]); // eight `<`
    expect(findConflicts(doc('<<<<<<<HEAD', 'a', '=======', 'b', '>>>>>>> feature'))).toEqual([]); // no space before the name
    expect(findConflicts(doc('<<<<<<< HEAD', 'a', '======= x', 'b', '>>>>>>> feature'))).toEqual([]); // a separator is the bare line
  });

  it('starts over at a `<<<<<<<` inside a run: the outer run is left alone, an inner balanced run is a block', () => {
    const text = doc('<<<<<<< outer', 'x', '<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> feature');
    const blocks = findConflicts(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].mine.label).toBe('HEAD');
    expect(blocks[0].from).toBe(text.line(3).from);
  });

  it('finds empty sections', () => {
    const text = doc('<<<<<<< HEAD', '=======', 'b', '>>>>>>> feature', '');
    const [block] = findConflicts(text);
    expect(block.mine.from).toBe(block.mine.to);
    expect(slice(text, block.theirs)).toBe('b\n');
  });

  const resolved = (text: string, choice: 'mine' | 'theirs' | 'both') => {
    const view = viewOf(text);
    const [block] = findConflicts(view.state.doc) as [ConflictBlock];
    resolve(view, block, choice);
    return view.state.doc.toString();
  };

  it('resolves a block to mine, to theirs, or to mine then theirs, leaving no marker line', () => {
    const text = `${DIFF3.join('\n')}\n`;
    expect(resolved(text, 'mine')).toBe('before\nmine 1\nmine 2\nafter\n');
    expect(resolved(text, 'theirs')).toBe('before\ntheirs 1\nafter\n');
    expect(resolved(text, 'both')).toBe('before\nmine 1\nmine 2\ntheirs 1\nafter\n');
  });

  it('keeps a file’s missing final newline when the block ends it', () => {
    expect(resolved('x\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feature', 'theirs')).toBe('x\nb');
    expect(resolved('x\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feature', 'both')).toBe('x\na\nb');
  });
});

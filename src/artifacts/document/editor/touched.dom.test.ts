// The ranges a transaction wrote, for the decoration plugins that redraw only what an edit touched (M9 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md: the scale gate). Mapping each step's range through the steps after
// it is quadratic in the steps, so a transaction of many steps (the binding's rebind of a 200-page tab is one step per
// block) answers null and the plugin redraws the whole document, which is linear.
import { describe, expect, it } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { schemaFor } from '../schema';
import { MAX_MAPPED_STEPS, touchedRanges } from './touched';

const schema = schemaFor();
const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const state = () => EditorState.create({ schema, doc: schema.nodes.doc.create(null, [paragraph('one'), paragraph('two'), paragraph('three')]) });

describe('touchedRanges', () => {
  it('answers each step’s range in the resulting document', () => {
    const tr = state().tr.insertText('X', 1).insertText('Y', 8);
    expect(touchedRanges(tr)).toEqual([
      [1, 2],
      [8, 9],
    ]);
  });

  it('answers a mark or attribute step’s own range', () => {
    const tr = state().tr.addMark(1, 3, schema.marks.bold.create()).setNodeAttribute(0, 'id', 'p1');
    expect(touchedRanges(tr)).toEqual([
      [1, 3],
      [0, 1],
    ]);
  });

  it('answers null past the bound, for the caller to redraw everything', () => {
    let tr = state().tr;
    for (let k = 0; k <= MAX_MAPPED_STEPS; k++) tr = tr.insertText('x', 1);
    expect(touchedRanges(tr)).toBeNull();
  });
});

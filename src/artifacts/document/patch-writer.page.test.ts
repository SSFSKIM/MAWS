// `set_page` through the planner and the writer (UX wave U10b, M2; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md
// §B.2, decision 2): an op of the plan, so a batch is all or none with it, the settings node is written in the batch's
// one transaction, and a batch of `set_page` alone is one transaction too.
import { describe, expect, it } from 'vitest';
import { stateV2 } from '../yjs';
import { EditError, type EditRefusal, type Op } from './edit-ops';
import { planEdit } from './edit-plan';
import { docPage, dsOverrides, setDocPage, setDsOverrides } from './meta';
import { applyEdit } from './patch-writer';
import { order, seedDoc, textOf } from './writer.fixture';

const refusal = (run: () => unknown): EditRefusal => {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return error.refusal;
    throw error;
  }
  throw new Error('the batch was not refused');
};
/** The transactions `run` opens on `doc`, by origin; what `run` throws, it throws. */
function transactions(doc: ReturnType<typeof seedDoc>, run: () => unknown): unknown[] {
  const origins: unknown[] = [];
  const note = (transaction: { origin: unknown }) => void origins.push(transaction.origin);
  doc.on('beforeTransaction', note);
  try {
    run();
  } finally {
    doc.off('beforeTransaction', note);
  }
  return origins;
}

describe('set_page', () => {
  it('alone is one transaction under the batch’s origin, and answers the page in force after it', () => {
    const doc = seedDoc();
    const origin = { agent: 'the session' };
    let answer: ReturnType<typeof applyEdit> | undefined;
    expect(transactions(doc, () => (answer = applyEdit(doc, [{ op: 'set_page', size: 'a4', density: 'compact' }], { origin })))).toEqual([origin]);
    expect(docPage(doc)).toEqual({ size: 'a4', density: 'compact' });
    expect(answer!.results).toEqual([{ op: 'set_page', size: 'a4', density: 'compact' }]);
    expect(answer!.carries).toEqual([]);
  });

  it('with block ops is the same one transaction, each op answered in its place', () => {
    const doc = seedDoc();
    const ops: Op[] = [
      { op: 'replace_text', block: 'p1', old: 'lazy', new: 'sleepy' },
      { op: 'set_page', density: 'compact' },
      { op: 'insert', after: 'h1', markdown: 'A new paragraph.' },
    ];
    let answer: ReturnType<typeof applyEdit> | undefined;
    expect(transactions(doc, () => (answer = applyEdit(doc, ops)))).toHaveLength(1);
    expect(textOf(doc, 'p1')).toContain('sleepy');
    expect(docPage(doc)).toEqual({ density: 'compact' });
    expect(answer!.results[1]).toEqual({ op: 'set_page', size: 'system', density: 'compact' });
    expect(answer!.results[0]).toMatchObject({ target: 'p1' });
    expect(answer!.results[2]).toMatchObject({ target: 'h1' });
  });

  it('leaves a field it does not give as it was; system clears the size and standard the density', () => {
    const doc = seedDoc();
    setDocPage(doc, { size: 'letter', density: 'compact' });
    expect(applyEdit(doc, [{ op: 'set_page', size: 'a4' }]).results).toEqual([{ op: 'set_page', size: 'a4', density: 'compact' }]);
    expect(docPage(doc)).toEqual({ size: 'a4', density: 'compact' });
    expect(applyEdit(doc, [{ op: 'set_page', density: 'standard' }]).results).toEqual([{ op: 'set_page', size: 'a4', density: 'standard' }]);
    expect(docPage(doc)).toEqual({ size: 'a4' });
    expect(applyEdit(doc, [{ op: 'set_page', size: 'system' }]).results).toEqual([{ op: 'set_page', size: 'system', density: 'standard' }]);
    expect(docPage(doc)).toEqual({});
  });

  it('answers each of two in one batch with what is in force after it; the plan carries the page the batch leaves', () => {
    const doc = seedDoc();
    const ops: Op[] = [
      { op: 'set_page', size: 'a4' },
      { op: 'set_page', density: 'compact' },
    ];
    expect(planEdit(doc, ops).page).toEqual({ size: 'a4', density: 'compact' });
    expect(planEdit(doc, [{ op: 'delete', id: 'p4' }]).page).toBeUndefined();
    expect(applyEdit(doc, ops).results).toEqual([
      { op: 'set_page', size: 'a4', density: 'standard' },
      { op: 'set_page', size: 'a4', density: 'compact' },
    ]);
  });

  it('beside a refused op leaves the page as it was and opens no transaction', () => {
    const doc = seedDoc();
    setDocPage(doc, { size: 'letter' });
    const before = stateV2(doc);
    const ops: Op[] = [
      { op: 'set_page', size: 'a4', density: 'compact' },
      { op: 'replace_text', block: 'p1', old: 'no such words', new: 'x' },
    ];
    let refused: EditRefusal | undefined;
    expect(transactions(doc, () => (refused = refusal(() => applyEdit(doc, ops))))).toEqual([]);
    expect(refused).toMatchObject({ reason: 'notFound', opIndex: 1 });
    expect(docPage(doc)).toEqual({ size: 'letter' });
    expect(stateV2(doc)).toEqual(before);
  });

  it('that changes nothing writes nothing', () => {
    const doc = seedDoc();
    setDocPage(doc, { size: 'a4' });
    const before = stateV2(doc);
    let answer: ReturnType<typeof applyEdit> | undefined;
    expect(transactions(doc, () => (answer = applyEdit(doc, [{ op: 'set_page', size: 'a4', density: 'standard' }])))).toEqual([]);
    expect(answer!.results).toEqual([{ op: 'set_page', size: 'a4', density: 'standard' }]);
    expect(stateV2(doc)).toEqual(before);
  });

  it('keeps the design-system overrides and the blocks as they are', () => {
    const doc = seedDoc();
    setDsOverrides(doc, { '--ds-color-accent': '#0a84ff' });
    const blocks = order(doc);
    applyEdit(doc, [{ op: 'set_page', size: 'a4' }]);
    expect(dsOverrides(doc)).toEqual({ '--ds-color-accent': '#0a84ff' });
    expect(order(doc)).toEqual(blocks);
  });
});

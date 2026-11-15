// A document's page (UX wave U10b, M2; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §B.1): one
// attribute of the settings node beside `dsOverrides`, set as one value, absent when the document follows its system.
import { describe, expect, it } from 'vitest';
import { applyV2, newDoc, stateV2 } from '../yjs';
import { docPage, dsOverrides, META, setDocPage, setDsOverrides } from './meta';
import { replica, sync } from './writer.fixture';

const transactionsOf = (doc: ReturnType<typeof newDoc>, run: () => void): unknown[] => {
  const origins: unknown[] = [];
  const note = (transaction: { origin: unknown }) => void origins.push(transaction.origin);
  doc.on('beforeTransaction', note);
  try {
    run();
  } finally {
    doc.off('beforeTransaction', note);
  }
  return origins;
};

describe('the document’s page (the settings node’s `page`)', () => {
  it('is empty until set, and is read back from the stored state as it was set', () => {
    const doc = newDoc();
    expect(docPage(doc)).toEqual({});
    setDocPage(doc, { size: 'a4', density: 'compact' });
    const reloaded = newDoc();
    applyV2(reloaded, stateV2(doc));
    expect(docPage(reloaded)).toEqual({ size: 'a4', density: 'compact' });
    expect(doc.get(META).getAttr('page')).toEqual({ size: 'a4', density: 'compact' });
  });

  it('is one transaction under the origin given, and an empty page removes the attribute', () => {
    const doc = newDoc();
    const origin = { by: 'the person' };
    expect(transactionsOf(doc, () => setDocPage(doc, { size: 'letter' }, origin))).toEqual([origin]);
    expect(docPage(doc)).toEqual({ size: 'letter' });
    setDocPage(doc, {});
    expect(docPage(doc)).toEqual({});
    expect(doc.get(META).getAttr('page')).toBeUndefined();
  });

  it('reads an unknown value of a field as absent, and anything but an object as no page', () => {
    const doc = newDoc();
    doc.get(META).setAttr('page', { size: 'legal', density: 'compact' });
    expect(docPage(doc)).toEqual({ density: 'compact' });
    doc.get(META).setAttr('page', { size: 'a4', density: 'airy', margins: 'wide' });
    expect(docPage(doc)).toEqual({ size: 'a4' });
    for (const value of ['a4', 7, null, ['a4']]) {
      doc.get(META).setAttr('page', value);
      expect(docPage(doc), JSON.stringify(value)).toEqual({});
    }
  });

  it('leaves the design-system overrides as they are, and they leave it, on one replica and across two', () => {
    const doc = newDoc();
    setDsOverrides(doc, { '--ds-color-accent': '#0a84ff' });
    setDocPage(doc, { density: 'compact' });
    expect(dsOverrides(doc)).toEqual({ '--ds-color-accent': '#0a84ff' });
    setDsOverrides(doc, { '--ds-type-body-size': '15px' });
    expect(docPage(doc)).toEqual({ density: 'compact' });
    // two writers at once, one on each attribute: both survive the merge
    const other = replica(doc);
    setDocPage(doc, { size: 'a4' });
    setDsOverrides(other, { '--ds-color-accent': '#b00020' });
    sync(doc, other);
    for (const each of [doc, other]) {
      expect(docPage(each)).toEqual({ size: 'a4' });
      expect(dsOverrides(each)).toEqual({ '--ds-color-accent': '#b00020' });
    }
  });
});

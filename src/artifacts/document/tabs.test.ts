// The tabs map and the document's own settings (D1, D2 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; S3's
// artifact model): tabs are created, renamed, reordered by a fractional `order`, deleted, and each body binds as a doc.
import { describe, expect, it } from 'vitest';
import { applyV2, newDoc, stateV2 } from '../yjs';
import { ynodeToPmnode } from '../yjs/prosemirror';
import { dsOverrides, setDsOverrides } from './meta';
import { schemaFor } from './schema';
import { addTab, createDocument, deleteTab, keyBetween, listTabs, moveTab, renameTab, tabBody } from './tabs';

const schema = schemaFor();
let n = 0;
const generateID = () => `x${++n}`;

describe('fractional order keys', () => {
  it('sorts every key between its neighbours, never ending in the lowest digit', () => {
    const keys = [keyBetween(null, null)];
    for (let i = 0; i < 30; i++) keys.push(keyBetween(keys[keys.length - 1], null));
    for (let i = 0; i < 30; i++) keys.unshift(keyBetween(null, keys[0]));
    let a = keys[10];
    const b = keys[11];
    for (let i = 0; i < 40; i++) {
      const mid = keyBetween(a, b);
      expect(a < mid && mid < b, `${a} < ${mid} < ${b}`).toBe(true);
      a = mid;
    }
    for (const key of keys) expect(key.endsWith('0')).toBe(false);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe('the tabs map', () => {
  it('creates the document with its first tab, a body that binds as a doc with one id’d paragraph', () => {
    const doc = newDoc();
    const first = createDocument(doc, { title: 'Untitled', generateID });
    expect(listTabs(doc)).toEqual([{ id: first, title: 'Untitled', order: expect.any(String) }]);
    const body = ynodeToPmnode(tabBody(doc, first)!, schema);
    expect(body.type.name).toBe('doc');
    expect(body.childCount).toBe(1);
    expect(body.child(0).type.name).toBe('paragraph');
    expect(body.child(0).attrs.id).toMatch(/^x\d+$/);
  });

  it('creates the first tab with given content', () => {
    const doc = newDoc();
    const content = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'heading', attrs: { id: 'h1', level: 1 }, content: [{ type: 'text', text: 'Hi' }] }] });
    const first = createDocument(doc, { title: 'Notes', body: content, generateID });
    expect(ynodeToPmnode(tabBody(doc, first)!, schema).toJSON()).toEqual(content.toJSON());
  });

  it('adds, renames, reorders and deletes tabs, the order surviving a reload', () => {
    const doc = newDoc();
    const a = createDocument(doc, { title: 'A', generateID });
    const c = addTab(doc, { title: 'C', generateID });
    const b = addTab(doc, { title: 'B', after: a, generateID });
    expect(listTabs(doc).map((tab) => tab.title)).toEqual(['A', 'B', 'C']);
    renameTab(doc, b, 'Bee');
    moveTab(doc, c, { before: a });
    expect(listTabs(doc).map((tab) => tab.title)).toEqual(['C', 'A', 'Bee']);
    moveTab(doc, c, { after: b });
    expect(listTabs(doc).map((tab) => tab.id)).toEqual([a, b, c]);
    deleteTab(doc, b);
    const reloaded = newDoc();
    applyV2(reloaded, stateV2(doc));
    expect(listTabs(reloaded).map((tab) => tab.title)).toEqual(['A', 'C']);
    expect(tabBody(reloaded, b)).toBeUndefined();
  });

  it('refuses to delete the last tab or to create a document twice', () => {
    const doc = newDoc();
    const only = createDocument(doc, { title: 'Only', generateID });
    expect(() => deleteTab(doc, only)).toThrow(/last tab/);
    expect(() => createDocument(doc, { title: 'Again', generateID })).toThrow(/already/);
  });

  it('writes each change as one transaction under the given origin', () => {
    const doc = newDoc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr) => origins.push(tr.origin));
    const origin = { actor: 'test' };
    const first = createDocument(doc, { title: 'A', generateID }, origin);
    addTab(doc, { title: 'B', generateID }, origin);
    renameTab(doc, first, 'Aa', origin);
    expect(origins).toEqual([origin, origin, origin]);
  });
});

describe('the document’s own settings (the root meta node)', () => {
  it('holds the design-system overrides, absent until set, cleared by null', () => {
    const doc = newDoc();
    expect(dsOverrides(doc)).toEqual({});
    setDsOverrides(doc, { '--ds-color-accent': '#0a84ff' });
    const reloaded = newDoc();
    applyV2(reloaded, stateV2(doc));
    expect(dsOverrides(reloaded)).toEqual({ '--ds-color-accent': '#0a84ff' });
    setDsOverrides(reloaded, null);
    expect(dsOverrides(reloaded)).toEqual({});
  });
});

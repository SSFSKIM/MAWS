import { describe, expect, it } from 'vitest';
import { applyV2, newDoc, stateV2, transact, type Doc } from './yjs';
import { FilesError, publishFiles, readFiles, readRoots } from './files';

const docWith = (files: Record<string, string>): Doc => {
  const doc = newDoc();
  transact(doc, () => {
    for (const [path, text] of Object.entries(files)) doc.get('files').setAttr(path, text);
  });
  return doc;
};
const clone = (doc: Doc): Doc => {
  const copy = newDoc();
  applyV2(copy, stateV2(doc));
  return copy;
};

describe('the generic file model (Decision Log 10)', () => {
  it('reads the files root, sorted by path, and nothing for a doc without one', () => {
    expect(readFiles(docWith({ 'b.md': 'B', 'a.md': 'A' }))).toEqual({ 'a.md': 'A', 'b.md': 'B' });
    expect(Object.keys(readFiles(docWith({ 'b.md': 'B', 'a.md': 'A' })))).toEqual(['a.md', 'b.md']);
    expect(readFiles(newDoc())).toEqual({});
  });

  it('reads the root types other than files as JSON, from a doc that only applied a state', () => {
    const doc = newDoc();
    transact(doc, () => {
      doc.get('root').setAttr('title', 'T');
      doc.get('root').insert(0, 'hello');
      doc.get('files').setAttr('a.md', 'A');
    });
    expect(readRoots(clone(doc))).toEqual({ root: { attrs: { title: 'T' }, children: ['hello'] } });
  });

  it('applies the agent’s changes over files nobody else changed, keeping the rest', () => {
    const base = { 'a.md': 'A', 'b.md': 'B', 'c.md': 'C' };
    const live = docWith(base);
    transact(live, () => live.get('files').setAttr('c.md', 'C by the user'));
    const result = publishFiles(live, base, { 'a.md': 'A2', 'b.md': null, 'new.md': 'N' }, false);
    expect(result).toEqual({ changed: ['a.md', 'b.md', 'new.md'], conflicts: [] });
    expect(readFiles(live)).toEqual({ 'a.md': 'A2', 'c.md': 'C by the user', 'new.md': 'N' });
  });

  it('refuses the whole publish naming each file changed since the read, writes nothing, and force overwrites them', () => {
    const base = { 'a.md': 'A', 'b.md': 'B' };
    const live = docWith(base);
    transact(live, () => {
      live.get('files').setAttr('a.md', 'A by the user');
      live.get('files').deleteAttr('b.md');
      live.get('files').setAttr('c.md', 'C by the user');
    });
    const before = readFiles(live);
    const sent = { 'a.md': 'A2', 'b.md': 'B2', 'c.md': 'C2', 'd.md': 'D' };
    expect(publishFiles(live, base, sent, false)).toEqual({
      changed: [],
      conflicts: [
        { path: 'a.md', detail: 'changed since your read' },
        { path: 'b.md', detail: 'removed since your read' },
        { path: 'c.md', detail: 'created since your read' },
      ],
    });
    expect(readFiles(live)).toEqual(before);
    expect(publishFiles(live, base, sent, true)).toEqual({ changed: ['a.md', 'b.md', 'c.md', 'd.md'], conflicts: [] });
    expect(readFiles(live)).toEqual({ 'a.md': 'A2', 'b.md': 'B2', 'c.md': 'C2', 'd.md': 'D' });
  });

  it('treats a file sent as it was read, or as it is live, as no change of the agent’s, even under force', () => {
    const base = { 'a.md': 'A' };
    const live = docWith(base);
    transact(live, () => live.get('files').setAttr('a.md', 'A by the user'));
    expect(publishFiles(live, base, { 'a.md': 'A' }, true)).toEqual({ changed: [], conflicts: [] });
    expect(publishFiles(live, base, { 'a.md': 'A by the user' }, false)).toEqual({ changed: [], conflicts: [] });
    expect(publishFiles(live, base, { 'gone.md': null }, false)).toEqual({ changed: [], conflicts: [] });
    expect(readFiles(live)).toEqual({ 'a.md': 'A by the user' });
  });

  it('refuses paths the model cannot hold before writing anything, with or without force', () => {
    const live = docWith({});
    for (const path of ['/abs.md', '../up.md', 'a/../b.md', 'a//b.md', 'dir/', 'a\\b.md', 'nul\u0000.md', '.', 'x'.repeat(513)]) {
      expect(() => publishFiles(live, {}, { [path]: 'x', 'ok.md': 'fine' }, true), path).toThrow(FilesError);
    }
    expect(readFiles(live)).toEqual({});
    try {
      publishFiles(live, {}, { '../up.md': 'x' }, false);
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid', data: { problems: [{ path: '../up.md' }] } });
    }
  });

  it('writes everything in one transaction (one update)', () => {
    const live = docWith({ 'a.md': 'A' });
    let updates = 0;
    live.on('update', () => updates++);
    publishFiles(live, { 'a.md': 'A' }, { 'a.md': 'A2', 'b.md': 'B', 'c.md': 'C' }, false);
    expect(updates).toBe(1);
  });
});

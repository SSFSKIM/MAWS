// The restore's revert, with P3-0's S7a reproductions (`s7/soak/deck/probe-revert-map.mjs`, `doc/probe-revert-attr.mjs`)
// as regression tests. The overwrite-twice cases are the v14 gap filed as https://github.com/yjs/yjs/issues/814: a map
// attribute changed two or more times since the version came back deleted (or the old value) under `Y.undoContentIds`.
// A re-pin to a `@y/y` that fixes it keeps these tests.
import * as Y from '@y/y';
import { describe, expect, it } from 'vitest';
import { revertUpdate } from './revert';

const live = () => {
  const doc = new Y.Doc({ gc: true });
  doc.clientID = 1;
  return doc;
};
const write = (doc: Y.Doc, client: number, edit: () => void) => {
  doc.clientID = client;
  doc.transact(edit);
};
const restore = (doc: Y.Doc, version: Uint8Array) => Y.applyUpdateV2(doc, revertUpdate(version, Y.encodeStateAsUpdateV2(doc)));
const element = (doc: Y.Doc) => doc.get('slides').getAttr('e1') as Y.Node | undefined;

describe('revertUpdate: a map attribute overwritten since the version (https://github.com/yjs/yjs/issues/814)', () => {
  const deck = (options: { n: number; clients: number; deleteKey?: boolean; deleteNode?: boolean; earlierRestore?: boolean }) => {
    const doc = live();
    write(doc, 1, () => {
      const el = new Y.Node('el');
      doc.get('slides').setAttr('e1', el);
      el.setAttr('left', 'v0');
      el.setAttr('top', 't0');
    });
    if (options.earlierRestore) {
      const first = Y.encodeStateAsUpdateV2(doc);
      write(doc, 2, () => element(doc)!.setAttr('left', 'x'));
      restore(doc, first);
    }
    const version = Y.encodeStateAsUpdateV2(doc);
    for (let k = 1; k <= options.n; k++) write(doc, 10 + (k % options.clients), () => element(doc)!.setAttr('left', `v${k}`));
    if (options.deleteKey) write(doc, 99, () => element(doc)!.deleteAttr('left'));
    if (options.deleteNode) write(doc, 98, () => doc.get('slides').deleteAttr('e1'));
    restore(doc, version);
    return element(doc)?.getAttrs() ?? null;
  };

  it.each([
    ['once', { n: 1, clients: 1 }],
    ['twice by one client', { n: 2, clients: 1 }],
    ['20 times by one client (a drag)', { n: 20, clients: 1 }],
    ['5 times by 3 clients', { n: 5, clients: 3 }],
    ['3 times, then the key deleted', { n: 3, clients: 2, deleteKey: true }],
    ['3 times, then the node deleted', { n: 3, clients: 2, deleteNode: true }],
    ['3 times after an earlier restore wrote the key', { n: 3, clients: 2, earlierRestore: true }],
  ])('brings the version’s value back when it was overwritten %s', (_, options) => {
    expect(deck(options)).toEqual({ left: 'v0', top: 't0' });
  });

  it('brings back a nested node’s attributes changed twice (a heading level, a task’s checked state)', () => {
    const doc = live();
    write(doc, 1, () => {
      const heading = new Y.Node('heading');
      heading.setAttr('level', 2);
      heading.insert(0, 'Title');
      const task = new Y.Node('taskItem');
      task.setAttr('checked', false);
      doc.get('body').insert(0, [heading, task]);
    });
    const version = Y.encodeStateAsUpdateV2(doc);
    for (const k of [1, 2]) {
      write(doc, 10 + k, () => {
        const [heading, task] = doc.get('body').toArray() as Y.Node[];
        heading.setAttr('level', k === 1 ? 3 : 1);
        task.setAttr('checked', k === 1);
      });
    }
    restore(doc, version);
    const [heading, task] = doc.get('body').toArray() as Y.Node[];
    expect(heading.getAttr('level')).toBe(2);
    expect(task.getAttr('checked')).toBe(false);
    expect(heading.toString()).toContain('Title');
  });
});

describe('revertUpdate: the whole doc, schema-agnostic', () => {
  it('reverts every root type (attributes, text, a nested child, a files entry) as one update', () => {
    const doc = live();
    write(doc, 1, () => {
      doc.get('root').setAttr('title', 'Plan');
      doc.get('root').insert(0, 'hello world');
      const child = new Y.Node('section');
      child.setAttr('id', 's1');
      child.insert(0, 'nested');
      doc.get('root').insert(doc.get('root').length, [child]);
      doc.get('files').setAttr('index.md', '# one');
    });
    const before = { root: doc.get('root').toJSON(), files: doc.get('files').toJSON() };
    const version = Y.encodeStateAsUpdateV2(doc);
    write(doc, 2, () => {
      doc.get('root').setAttr('title', 'Renamed');
      doc.get('root').delete(0, 6);
      doc.get('root').insert(0, 'bye ');
      (doc.get('root').toArray().find((item) => item instanceof Y.Node) as Y.Node).insert(0, 'more ');
      doc.get('files').setAttr('index.md', '# two');
      doc.get('files').setAttr('extra.md', 'new file');
    });
    restore(doc, version);
    expect(doc.get('root').toJSON()).toEqual(before.root);
    expect(doc.get('files').toJSON()).toEqual(before.files);
  });

  it('answers a decodable empty update when nothing changed since the version', () => {
    const doc = live();
    write(doc, 1, () => doc.get('root').setAttr('title', 'Plan'));
    const version = Y.encodeStateAsUpdateV2(doc);
    const update = revertUpdate(version, Y.encodeStateAsUpdateV2(doc));
    expect(() => Y.applyUpdateV2(new Y.Doc(), update)).not.toThrow();
    const sv = Y.encodeStateVector(doc);
    Y.applyUpdateV2(doc, update);
    expect(Y.encodeStateVector(doc)).toEqual(sv);
    expect(doc.get('root').getAttr('title')).toBe('Plan');
  });

  it('leaves in place the changes since the version that `keep` names, and reverts the rest', () => {
    const doc = live();
    write(doc, 1, () => doc.get('root').setAttr('title', 'Plan'));
    const version = Y.encodeStateAsUpdateV2(doc);
    write(doc, 2, () => doc.get('root').setAttr('title', 'Renamed'));
    const beforeThread = Y.encodeStateVector(doc);
    write(doc, 3, () => doc.get('threads').setAttr('t1', 'a message posted since'));
    // the posted message's insert (a diff carries the whole delete set, which is not the message's)
    const keep = Y.createContentIds(Y.createContentIdsFromUpdate(Y.encodeStateAsUpdate(doc, beforeThread)).inserts, Y.createIdSet());
    Y.applyUpdateV2(doc, revertUpdate(version, Y.encodeStateAsUpdateV2(doc), keep));
    expect(doc.get('root').getAttr('title')).toBe('Plan');
    expect(doc.get('threads').getAttr('t1')).toBe('a message posted since');
  });
});

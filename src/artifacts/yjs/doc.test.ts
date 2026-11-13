import { EditorState } from '@tiptap/pm/state';
import { Schema } from '@tiptap/pm/model';
import * as Y from '@y/y';
import { ySyncPluginKey } from '@y/prosemirror';
import { describe, expect, it } from 'vitest';
import { adoptClientId, applyV1, applyV2, bindingVersion, diffV1, isBindingTransaction, newDoc, newDocGcOff, newSuggestionDoc, onUpdate, stateV2, stateVector, transact, type Doc } from './doc';
import { liveMarkers, newDocAsF } from './format-cleanup.fixture';

describe('the binding module’s docs and encodings', () => {
  it('round-trips a schema-agnostic doc through the wire (V1), a version state (V2) and a reload, identically', () => {
    const writer = newDoc();
    const root = writer.get('root');
    transact(writer, () => {
      root.setAttr('title', 'Quarterly');
      root.setAttr('status', { draft: true, owner: 'human' });
      root.insert(0, 'hello world');
      const child = new Y.Node('section');
      child.setAttr('id', 's1');
      child.insert(0, 'nested text');
      root.insert(root.length, [child]);
    });
    root.delete(0, 6);
    writer.get('files').setAttr('index.html', '<p>x</p>');

    const replica = newDoc();
    applyV1(replica, diffV1(writer)); // the wire and the log
    const version = stateV2(replica); // a version row
    const reloaded = newDoc();
    applyV2(reloaded, version); // a load from the latest retained state

    for (const doc of [replica, reloaded]) {
      expect(doc.get('root').toJSON()).toEqual(writer.get('root').toJSON());
      expect(doc.get('files').toJSON()).toEqual(writer.get('files').toJSON());
      expect(stateVector(doc)).toEqual(stateVector(writer));
    }
    expect(reloaded.get('root').getAttr('title')).toBe('Quarterly');
    expect(reloaded.get('root').toString()).toContain('world');
    expect(stateV2(reloaded)).toEqual(version);
  });

  it('reports each transaction as one V1 update with its origin, until unsubscribed', () => {
    const doc = newDoc();
    const seen: { bytes: number; origin: unknown }[] = [];
    const off = onUpdate(doc, (update, origin) => seen.push({ bytes: update.length, origin }));
    transact(doc, () => {
      doc.get('t').insert(0, 'a');
      doc.get('t').setAttr('k', 1);
    }, 'session:x');
    off();
    doc.get('t').insert(0, 'b');
    expect(seen).toHaveLength(1);
    expect(seen[0].origin).toBe('session:x');
  });

  it('names its pins', () => {
    expect(bindingVersion).toBe('y14-rc28/ypm2-15');
  });

  it('writes under an adopted clientID, continuing the clocks a reload holds (a host replica keeps one per actor)', () => {
    const first = newDoc();
    adoptClientId(first, 4242);
    first.get('t').insert(0, 'abc');
    expect(first.clientID).toBe(4242);
    const reloaded = newDoc();
    applyV1(reloaded, diffV1(first)); // loaded under its own random clientID, then adopts the bound one
    adoptClientId(reloaded, 4242);
    reloaded.get('t').insert(3, 'd');
    expect(reloaded.clientID).toBe(4242);
    const host = newDoc();
    applyV1(host, diffV1(first));
    applyV1(host, diffV1(reloaded, stateVector(host)));
    expect(host.get('t').toString()).toBe('abcd');
    expect([...Y.decodeStateVector(stateVector(host)).keys()]).toEqual([4242]); // one writer, one clientID
  });
});

describe('isBindingTransaction', () => {
  const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
  const tr = () => EditorState.create({ schema }).tr;

  it('is true for the metas @y/prosemirror’s binding sets on its own transactions', () => {
    expect(isBindingTransaction(tr().setMeta(ySyncPluginKey, { binding: true }))).toBe(true);
    expect(isBindingTransaction(tr().setMeta('y-sync-transaction', 'remote'))).toBe(true);
    expect(isBindingTransaction(tr().setMeta('y-sync-append', true))).toBe(true);
  });

  it('is false for a user’s transaction', () => {
    expect(isBindingTransaction(tr().insertText('typed'))).toBe(false);
    expect(isBindingTransaction(tr().setMeta('addToHistory', false))).toBe(false);
  });
});

// l6-artifacts-07 (a), the pin: no doc MAWS builds runs Yjs's post-apply formatting clean-up, which would be a write of
// that doc's own that no caller started. One writer bolds a word while another, not having seen the bold, deletes it:
// the deletion, applied after the bold, leaves the bold's two markers around nothing, which is what the clean-up acts on.
describe('a doc from the constructors writes nothing after an apply (l6-artifacts-07 (a))', () => {
  function boldThenDeletion(make: () => Doc) {
    const base = make();
    base.get('t').insert(0, 'one word two');
    const bolder = make();
    const deleter = make();
    applyV1(bolder, diffV1(base));
    applyV1(deleter, diffV1(base));
    const sv = stateVector(bolder);
    bolder.get('t').format(4, 4, { bold: true });
    deleter.get('t').delete(4, 4);
    return { base: diffV1(base), bold: diffV1(bolder, sv), deletion: diffV1(deleter, stateVector(base)) };
  }
  // A doc holding the base and the bold, and every transaction and update it runs while `apply` applies the deletion.
  function receive(make: () => Doc, apply: (doc: Doc, deletion: Uint8Array) => void) {
    const updates = boldThenDeletion(make);
    const doc = make();
    applyV1(doc, updates.base);
    applyV1(doc, updates.bold);
    const transactions: unknown[] = [];
    const emitted: unknown[] = [];
    doc.on('beforeTransaction', (transaction) => transactions.push(transaction.origin));
    onUpdate(doc, (_update, origin) => emitted.push(origin));
    apply(doc, updates.deletion);
    return { transactions, emitted, markers: liveMarkers(doc.get('t')), text: doc.get('t').toString() };
  }
  const plain = (doc: Doc, deletion: Uint8Array) => applyV1(doc, deletion, 'remote');
  const nested = (doc: Doc, deletion: Uint8Array) => transact(doc, () => applyV1(doc, deletion, 'remote'), 'outer'); // a restore's, an accept's shape

  it('the control: a doc built with Yjs’s defaults deletes a marker after the apply, in a transaction of no origin', () => {
    expect(receive(newDocAsF, plain)).toEqual({ transactions: ['remote', null], emitted: ['remote', null], markers: 1, text: 'one  two' });
    expect(receive(newDocAsF, nested)).toEqual({ transactions: ['outer', null], emitted: ['outer', null], markers: 1, text: 'one  two' });
  });

  for (const [name, make] of [['newDoc', newDoc], ['newSuggestionDoc', newSuggestionDoc], ['newDocGcOff', newDocGcOff]] as const) {
    it(`${name}: runs the apply’s transaction alone and emits only its update, also when the apply joins an open transaction`, () => {
      expect(receive(make, plain)).toEqual({ transactions: ['remote'], emitted: ['remote'], markers: 2, text: 'one  two' });
      expect(receive(make, nested)).toEqual({ transactions: ['outer'], emitted: ['outer'], markers: 2, text: 'one  two' });
    });
  }

  it('keeps the writer’s own clean-up: deleting a whole bold word removes its markers in the same transaction, one update', () => {
    const doc = newDoc();
    transact(doc, () => {
      doc.get('t').insert(0, 'one word two');
      doc.get('t').format(4, 4, { bold: true });
    });
    expect(liveMarkers(doc.get('t'))).toBe(2);
    const emitted: unknown[] = [];
    onUpdate(doc, (_update, origin) => emitted.push(origin));
    let deleted = 0;
    doc.on('afterTransaction', (transaction) => transaction.deleteSet.clients.forEach((ranges) => ranges.getIds().forEach((range) => (deleted += range.len))));
    transact(doc, () => doc.get('t').delete(4, 4), 'writer');
    expect(emitted).toEqual(['writer']);
    expect(deleted).toBe(6); // the four characters and the two markers
    expect(liveMarkers(doc.get('t'))).toBe(0);
    expect(doc.get('t').toString()).toBe('one  two');
  });
});

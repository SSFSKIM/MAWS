import { EditorState } from '@tiptap/pm/state';
import { Schema } from '@tiptap/pm/model';
import * as Y from '@y/y';
import { ySyncPluginKey } from '@y/prosemirror';
import { describe, expect, it } from 'vitest';
import { adoptClientId, applyV1, applyV2, bindingVersion, diffV1, isBindingTransaction, newDoc, onUpdate, stateV2, stateVector, transact } from './doc';

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

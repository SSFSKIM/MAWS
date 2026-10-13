import * as Y from '@y/y';
import { describe, expect, it } from 'vitest';
import { checkUpdate, hasPending } from './check';
import { applyV1, diffV1, newDoc, stateVector } from './doc';

// Each bad shape is first applied unchecked to a scratch doc, to show it is one plain v14 would hold outside its log
// (S2's v14 probes), then refused by the check against a fresh copy of the same host state.
function uncheckedLeavesPending(hostState: Uint8Array, update: Uint8Array): boolean {
  const scratch = newDoc();
  applyV1(scratch, hostState);
  applyV1(scratch, update);
  return hasPending(scratch);
}

describe('checkUpdate', () => {
  it('refuses a pure gap: a later root of the same client without the clocks before it', () => {
    const writer = newDoc();
    writer.get('x').insert(0, 'abc');
    const sv = stateVector(writer);
    writer.get('y').insert(0, 'def');
    const gapped = diffV1(writer, sv);
    const host = newDoc();
    expect(uncheckedLeavesPending(diffV1(host), gapped)).toBe(true); // v14 integrates it behind a Skip
    expect(checkUpdate(host, gapped)).toMatch(/gap/);
  });

  it('refuses a parent-missing gap: text for a node the host never received', () => {
    const writer = newDoc();
    const paragraph = new Y.Node('paragraph');
    writer.get('content').push([paragraph]);
    paragraph.insert(0, 'abc');
    const sv = stateVector(writer);
    paragraph.insert(3, 'def');
    const gapped = diffV1(writer, sv);
    const host = newDoc();
    expect(uncheckedLeavesPending(diffV1(host), gapped)).toBe(true);
    expect(checkUpdate(host, gapped)).toMatch(/gap/);
  });

  it("refuses a missing origin: an insert after another client's text the host does not have", () => {
    const a = newDoc();
    const b = newDoc();
    a.get('content').push([new Y.Node('paragraph')]);
    const paragraphOnly = diffV1(a);
    applyV1(b, paragraphOnly);
    const aBefore = stateVector(a);
    (a.get('content').get(0) as Y.Node).insert(0, 'from A');
    applyV1(b, diffV1(a, aBefore));
    const bBefore = stateVector(b);
    (b.get('content').get(0) as Y.Node).insert(6, ' then B');
    const update = diffV1(b, bBefore); // B's own clocks only, continuing from what the host has of B (nothing)
    const host = newDoc();
    applyV1(host, paragraphOnly);
    expect(uncheckedLeavesPending(paragraphOnly, update)).toBe(true); // parked as pendingStructs
    expect(checkUpdate(host, update)).toMatch(/origin that does not exist/);
  });

  it('refuses a deletion of clocks nobody has', () => {
    const forger = newDoc();
    forger.get('content').insert(0, 'xyz');
    const sv = stateVector(forger);
    forger.get('content').delete(0, 3);
    const deletionOnly = diffV1(forger, sv);
    const host = newDoc();
    expect(uncheckedLeavesPending(diffV1(host), deletionOnly)).toBe(true); // parked as pendingDs
    expect(checkUpdate(host, deletionOnly)).toMatch(/deletion past clock/);
  });

  it('refuses a live parent that is not a type (a forged structure)', () => {
    const forger = newDoc();
    forger.clientID = 2;
    forger.get('content').push([new Y.Node('paragraph')]); // 2:0 is a type in the forger's doc
    const sv = stateVector(forger);
    (forger.get('content').get(0) as Y.Node).insert(0, 'zz'); // parent ID 2:0
    const forged = diffV1(forger, sv);
    const other = newDoc();
    other.clientID = 2;
    other.get('t').insert(0, 'q'); // in the host, 2:0 is a string
    const host = newDoc();
    applyV1(host, diffV1(other));
    expect(checkUpdate(host, forged)).toMatch(/not a type/);
  });

  it('accepts text for a node another replica deleted meanwhile, which the integrator tombstones', () => {
    const base = newDoc();
    base.get('content').push([new Y.Node('paragraph')]);
    const baseState = diffV1(base);
    const deleter = newDoc();
    applyV1(deleter, baseState);
    const deleterBefore = stateVector(deleter);
    deleter.get('content').delete(0, 1);
    const deletion = diffV1(deleter, deleterBefore);
    const writer = newDoc();
    applyV1(writer, baseState);
    const writerBefore = stateVector(writer);
    (writer.get('content').get(0) as Y.Node).insert(0, 'late text'); // its first text: the parent goes by ID
    const late = diffV1(writer, writerBefore);

    const host = newDoc(); // gc on: the deleted paragraph's item now holds ContentDeleted
    applyV1(host, baseState);
    applyV1(host, deletion);
    expect(checkUpdate(host, late)).toBeNull();
    applyV1(host, late);
    expect(hasPending(host)).toBe(false);
    expect(host.get('content').toString()).not.toContain('late text');
  });

  it('accepts text for a node whose ancestor was deleted and collected to a GC struct', () => {
    const base = newDoc();
    base.transact(() => {
      const section = new Y.Node('section');
      base.get('content').push([section]);
      section.push([new Y.Node('paragraph')]);
    });
    const baseState = diffV1(base);
    const deleter = newDoc();
    applyV1(deleter, baseState);
    const deleterBefore = stateVector(deleter);
    deleter.get('content').delete(0, 1);
    const deletion = diffV1(deleter, deleterBefore);
    const writer = newDoc();
    applyV1(writer, baseState);
    const writerBefore = stateVector(writer);
    ((writer.get('content').get(0) as Y.Node).get(0) as Y.Node).insert(0, 'late');
    const late = diffV1(writer, writerBefore);

    const host = newDoc();
    applyV1(host, baseState);
    applyV1(host, deletion);
    expect(checkUpdate(host, late)).toBeNull();
    applyV1(host, late);
    expect(hasPending(host)).toBe(false);
  });

  it('refuses bytes that do not decode', () => {
    expect(checkUpdate(newDoc(), new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x01]))).toMatch(/undecodable/);
  });

  it('accepts concurrent updates from two replicas of the same base, in either order, and they converge', () => {
    const base = newDoc();
    const text = base.get('t');
    text.setAttr('title', 'Draft');
    for (let i = 0; i < 10; i++) text.insert(text.length, `w${i} `);
    const baseState = diffV1(base);
    const replica = (edit: (root: Y.Node) => void) => {
      const doc = newDoc();
      applyV1(doc, baseState);
      const before = stateVector(doc);
      edit(doc.get('t'));
      return diffV1(doc, before);
    };
    const fromA = replica((root) => {
      root.insert(3, 'AAA');
      root.delete(10, 4);
    });
    const fromB = replica((root) => {
      root.insert(3, 'BBB');
      root.setAttr('title', 'Final');
    });
    const results = [
      [fromA, fromB],
      [fromB, fromA],
    ].map(([first, second]) => {
      const host = newDoc();
      applyV1(host, baseState);
      for (const update of [first, second]) {
        expect(checkUpdate(host, update)).toBeNull();
        applyV1(host, update);
        expect(hasPending(host)).toBe(false);
      }
      return host.get('t').toString();
    });
    expect(results[0]).toBe(results[1]);
    expect(results[0]).toContain('AAA');
    expect(results[0]).toContain('BBB');
  });

  it('accepts a step 2 that re-sends structs the host already has alongside new ones', () => {
    const replica = newDoc();
    replica.get('t').insert(0, 'hello');
    const host = newDoc();
    applyV1(host, diffV1(replica));
    replica.get('t').insert(5, ' world');
    const everything = diffV1(replica); // from an empty state vector: overlaps what the host has
    expect(checkUpdate(host, everything)).toBeNull();
    applyV1(host, everything);
    expect(hasPending(host)).toBe(false);
    expect(host.get('t').toString()).toBe(replica.get('t').toString());
  });

  it('accepts a nested child created in the same update as its text', () => {
    const replica = newDoc();
    const host = newDoc();
    const before = stateVector(replica);
    replica.transact(() => {
      const paragraph = new Y.Node('paragraph');
      replica.get('content').push([paragraph]);
      paragraph.insert(0, 'inside');
    });
    const update = diffV1(replica, before);
    expect(checkUpdate(host, update)).toBeNull();
    applyV1(host, update);
    expect(hasPending(host)).toBe(false);
  });
});

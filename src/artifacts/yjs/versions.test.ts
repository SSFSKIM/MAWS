import * as Y from '@y/y';
import { describe, expect, it } from 'vitest';
import { canonicalV2, mergeV2, versionDelta } from './versions';

// A doc edited in steps, each step's state captured as a version would be.
function history(): Uint8Array[] {
  const doc = new Y.Doc({ gc: true });
  const states: Uint8Array[] = [];
  const step = (edit: () => void) => {
    doc.transact(edit);
    states.push(Y.encodeStateAsUpdateV2(doc));
  };
  step(() => {
    doc.get('root').insert(0, 'x'.repeat(4_000));
    doc.get('root').setAttr('title', 'Plan');
  });
  step(() => doc.get('root').insert(10, 'inserted '));
  step(() => doc.get('root').delete(100, 500));
  step(() => {
    doc.get('root').setAttr('title', 'Renamed');
    doc.get('files').setAttr('a.md', 'one');
  });
  step(() => doc.get('files').setAttr('a.md', 'two'));
  step(() => doc.get('root').delete(0, 20));
  return states;
}

describe('version deltas (Decision Log 8)', () => {
  it('reconstructs every version byte-identically from its keyframe merged with the deltas after it', () => {
    const states = history();
    const deltas = states.slice(1).map((state, i) => versionDelta(states[i], state));
    for (let i = 1; i < states.length; i++) {
      expect(canonicalV2(mergeV2([states[0], ...deltas.slice(0, i)]))).toEqual(canonicalV2(states[i]));
    }
  });

  it('keeps a delta to the change since the previous state, not the whole delete set again', () => {
    const states = history();
    const last = versionDelta(states[4], states[5]);
    expect(last.length).toBeLessThan(states[5].length / 4);
    // deleting again what was already deleted adds no deletion to the next delta
    const sameAgain = versionDelta(states[5], states[5]);
    expect(Y.createContentIdsFromUpdateV2(sameAgain as Uint8Array<ArrayBuffer>).deletes.isEmpty()).toBe(true);
  });

  it('folds a dropped delta into its successor: the merged delta rebuilds the successor from the dropped one’s base', () => {
    const states = history();
    const d2 = versionDelta(states[1], states[2]);
    const d3 = versionDelta(states[2], states[3]);
    expect(canonicalV2(mergeV2([states[1], mergeV2([d2, d3])]))).toEqual(canonicalV2(states[3]));
  });
});

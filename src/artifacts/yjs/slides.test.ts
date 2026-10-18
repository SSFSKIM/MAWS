// P3-C M2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D2, D5): the deck model's seam: text and notes
// patched at character level, the slides an update touched, and what a restore keeps of the conversations.
import { describe, expect, it } from 'vitest';
import { applyV1, applyV2, diffV1, newDoc, onUpdate, revertUpdate, stateV2, stateVector, transact, type Doc } from './index';
import * as Y from './slides';

const sync = (to: Doc, from: Doc) => applyV1(to, diffV1(from, stateVector(to)));
/** The update one transaction produced (what the host's afterUpdate is given), not a diff since a state vector, which
 * carries the doc's whole delete set. */
function captured(doc: Doc, edit: () => void): Uint8Array {
  let update: Uint8Array | null = null;
  const off = onUpdate(doc, (u) => (update = u));
  transact(doc, edit);
  off();
  return update!;
}
function deck(): Doc {
  const doc = newDoc();
  transact(doc, () => {
    for (const id of ['s1', 's2', 's3']) {
      Y.createSlide(doc, id, { order: `a${id.slice(1)}` }, `notes of ${id}`);
      Y.createElement(doc, id, 'title', { tag: 'h2', parent: '', order: 'a0', 'style:color': '#111111' }, [{ type: 'p', inline: [{ text: 'Title', marks: {} }] }]);
      Y.createElement(doc, id, 'box', { tag: 'div', parent: '', order: 'a1' });
    }
    Y.setDeckKey(doc, 'title', 'Deck');
  });
  return doc;
}

describe('the seam: text and notes', () => {
  it('patches a block at character level, marks and line breaks included, so a concurrent edit elsewhere survives', () => {
    const a = deck();
    transact(a, () => Y.patchText(a, 's1', 'title', [{ type: 'p', inline: [{ text: 'Title here', marks: {} }] }]));
    const b = newDoc();
    sync(b, a);
    transact(a, () => Y.patchText(a, 's1', 'title', [{ type: 'p', inline: [{ text: 'The ', marks: {} }, { text: 'Title', marks: { b: {} } }, { text: ' here', marks: {} }] }]));
    transact(b, () => Y.patchText(b, 's1', 'title', [{ type: 'p', inline: [{ text: 'Title here', marks: {} }, { br: true }, { text: 'now', marks: {} }] }]));
    sync(a, b);
    sync(b, a);
    const want = [{ type: 'p', inline: [{ text: 'The ', marks: {} }, { text: 'Title', marks: { b: {} } }, { text: ' here', marks: {} }, { br: true }, { text: 'now', marks: {} }] }];
    expect(Y.readText(a, 's1', 'title')).toEqual(want);
    expect(Y.readText(b, 's1', 'title')).toEqual(want);
  });

  it('patches notes by a character diff and writes nothing when they are equal', () => {
    const a = deck();
    const b = newDoc();
    sync(b, a);
    expect(Y.patchNotes(a, 's2', 'notes of s2')).toBe(false);
    transact(a, () => Y.patchNotes(a, 's2', 'the notes of s2'));
    transact(b, () => Y.patchNotes(b, 's2', 'notes of s2, said twice'));
    sync(a, b);
    expect(Y.readNotes(a, 's2')).toBe('the notes of s2, said twice');
  });
});

describe('the seam: the slides an update touched', () => {
  it('names the slides of a property change, a text edit, a new element and a deletion, and none for the deck’s keys', () => {
    const doc = deck();
    expect(Y.touchedSlides(doc, captured(doc, () => Y.setElementKey(doc, 's2', 'box', 'style:left', '10px')))).toEqual(new Set(['s2']));
    expect(Y.touchedSlides(doc, captured(doc, () => Y.patchText(doc, 's3', 'title', [{ type: 'p', inline: [{ text: 'Titles', marks: {} }] }])))).toEqual(new Set(['s3']));
    expect(Y.touchedSlides(doc, captured(doc, () => Y.createElement(doc, 's1', 'new', { tag: 'p', parent: 'box', order: 'a0' }, [])))).toEqual(new Set(['s1']));
    expect(Y.touchedSlides(doc, captured(doc, () => Y.deleteElement(doc, 's1', 'box')))).toEqual(new Set(['s1']));
    expect(Y.touchedSlides(doc, captured(doc, () => Y.setSlideKey(doc, 's3', 'order', 'a0V')))).toEqual(new Set(['s3']));
    expect(Y.touchedSlides(doc, captured(doc, () => Y.setDeckKey(doc, 'title', 'Renamed')))).toEqual(new Set());
  });

  it('reads an update from another replica once it is applied, and answers null for content the doc does not hold', () => {
    const host = deck();
    const replica = newDoc();
    sync(replica, host);
    const update = captured(replica, () => {
      Y.setElementKey(replica, 's1', 'title', 'style:color', '#222222');
      Y.setElementKey(replica, 's3', 'box', 'z', 'a5');
    });
    expect(Y.touchedSlides(newDoc(), update)).toBeNull();
    applyV1(host, update);
    expect(Y.touchedSlides(host, update)).toEqual(new Set(['s1', 's3']));
  });
});

describe('the seam: what a restore keeps of the conversations', () => {
  it('keeps messages posted since the version and threads created since, and reverts a status set since', () => {
    const doc = deck();
    transact(doc, () => {
      Y.createThread(doc, 't1', { slideId: 's1', elementId: 'title', status: 'open' });
      Y.postMessage(doc, 't1', { by: 'human', text: 'first' });
    });
    const version = stateV2(doc);
    transact(doc, () => {
      Y.postMessage(doc, 't1', { by: 'agent', text: 'a reply' });
      Y.setThreadKey(doc, 't1', 'status', 'resolved');
      Y.createThread(doc, 't2', { slideId: 's2', elementId: 'box', status: 'open' });
      Y.postMessage(doc, 't2', { by: 'human', text: 'new thread' });
      Y.setThreadKey(doc, 't2', 'status', 'resolved');
      Y.setElementKey(doc, 's1', 'title', 'style:color', '#ff0000');
      Y.setThreadKey(doc, 't2', 'status', 'open');
    });
    const old = newDoc();
    applyV2(old, version);
    const update = revertUpdate(version, stateV2(doc), Y.conversationsSince(doc, old));
    applyV2(doc, update);
    expect(Y.elementScalars(doc, 's1', 'title')['style:color']).toBe('#111111');
    expect(Y.threadScalars(doc, 't1').status).toBe('open');
    expect(Y.threadMessages(doc, 't1')).toEqual([
      { by: 'human', text: 'first' },
      { by: 'agent', text: 'a reply' },
    ]);
    expect(Y.threadIds(doc).sort()).toEqual(['t1', 't2']);
    expect(Y.threadScalars(doc, 't2').status).toBe('open'); // a thread created since keeps its own state
    expect(Y.threadMessages(doc, 't2')).toEqual([{ by: 'human', text: 'new thread' }]);
  });

  it('keeps nothing when no conversation moved', () => {
    const doc = deck();
    const old = newDoc();
    applyV2(old, stateV2(doc));
    transact(doc, () => Y.setElementKey(doc, 's1', 'title', 'style:color', '#ff0000'));
    expect(Y.conversationsSince(doc, old).inserts.isEmpty()).toBe(true);
  });
});

describe('the seam: change records', () => {
  it('reports one slide’s changes per transaction as model records', () => {
    const doc = deck();
    const seen: Y.Change[][] = [];
    const off = Y.observeSlide(doc, 's1', (changes) => seen.push(changes));
    transact(doc, () => {
      Y.setElementKey(doc, 's1', 'title', 'style:left', '1px');
      Y.patchText(doc, 's1', 'title', [{ type: 'p', inline: [{ text: 'Titled', marks: {} }] }]);
      Y.createElement(doc, 's1', 'n', { tag: 'p', parent: '', order: 'a2' });
      Y.deleteElement(doc, 's1', 'box');
      Y.patchNotes(doc, 's1', 'new notes');
      Y.setSlideKey(doc, 's1', 'attr:hidden', '');
    });
    transact(doc, () => Y.setElementKey(doc, 's2', 'title', 'style:left', '1px')); // another slide: not reported
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(
      expect.arrayContaining([
        { kind: 'slide', keys: ['attr:hidden'] },
        { kind: 'notes' },
        { kind: 'text', id: 'title' },
        { kind: 'element', id: 'title', keys: ['style:left'] },
        { kind: 'added', id: 'n' },
        { kind: 'removed', id: 'box' },
      ]),
    );
  });
});

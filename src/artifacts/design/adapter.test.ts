// P3-E1 M1: the design kind's adapter on A's `KindAdapter`: C's hooks composed (the repair, the quotes a removal keeps,
// the threads mirror, the conversation-keeping restore) with the design's own seed, files, paths, publish, frame repair
// and turn summary. The real store's cases are src/engine-host/designs/adapter.test.ts.
import { describe, expect, it } from 'vitest';
import { deckFiles } from '../slides/model';
import { addThread, threadStates } from '../slides/threads';
import { applyV1, diffV1, newDoc, stateVector, transact } from '../yjs';
import { boardPath, CANVAS_PATH } from './canvas';
import { createDesignAdapter, summarizeDesignTurn } from './adapter';
import { boardFrame, designFiles, readCanvas, writeBoardEntry } from './model';
import { design, replicaFrom, updatesOf } from './fixtures/support';

const human = { kind: 'human' as const };
const adapter = createDesignAdapter();

describe('the design adapter', () => {
  it('is the design kind and seeds a new design with its manifest and one desktop board', () => {
    expect(adapter.kind).toBe('design');
    const doc = newDoc();
    adapter.initial!(doc, { title: 'Launch' });
    expect(readCanvas(doc)).toMatchObject({ v: 1, title: 'Launch', order: ['desktop'], boards: { desktop: { x: 0, y: 0, w: 1440, h: 1024, title: 'Desktop' } } });
    expect(adapter.readFiles!(doc)).toEqual(designFiles(doc));
    expect(adapter.paths!(doc)).toEqual([CANVAS_PATH, boardPath('desktop')]);
    expect(Object.keys(deckFiles(doc))).not.toContain(CANVAS_PATH); // C's reader is not the design's
  });

  it('keeps a commented element’s last text when the agent’s publish removes it', () => {
    const doc = design();
    addThread(doc, { threadId: 't1', slideId: 'b1', elementId: 'body', quote: '', by: human, at: 1, body: 'hi' }, 'deck-comments');
    const base = designFiles(doc);
    const out = adapter.publish!(doc, base, { [boardPath('b1')]: base[boardPath('b1')]!.replace(/<p id="body"[^]*?<\/p>/, '') }, false);
    expect(out.conflicts).toEqual([]);
    expect(threadStates(doc)[0]).toMatchObject({ orphan: true, quote: 'Body of b1' });
  });

  it('repairs, after an update, a frame two valid writes merged past the cap, and mirrors the threads the update touched', () => {
    const host = design([{ id: 'big', at: { x: 0, y: 0, w: 8192, h: 4096 } }]);
    const a = replicaFrom(host, 10);
    transact(a, () => writeBoardEntry(a, 'big', { w: 16_384 }));
    transact(host, () => writeBoardEntry(host, 'big', { h: 8192 }));
    const incoming = updatesOf(host, () => applyV1(host, diffV1(a, stateVector(host)), 'remote'));
    expect(boardFrame(host, 'big')).toEqual({ x: 0, y: 0, w: 16_384, h: 8192 });
    adapter.afterUpdate!(host, { artifactId: 'd1', update: incoming[0]!, actor: human });
    expect(boardFrame(host, 'big')).toEqual({ x: 0, y: 0, w: 16_384, h: 4096 });
    addThread(host, { threadId: 't1', slideId: 'big', elementId: '', quote: '', by: human, at: 5, body: 'board' }, 'deck-comments');
    const [threaded] = updatesOf(host, () => addThread(host, { threadId: 't2', slideId: 'big', elementId: 'title', quote: '', by: human, at: 6, body: 'el' }, 'deck-comments'));
    expect(adapter.afterUpdate!(host, { artifactId: 'd1', update: threaded!, actor: human })).toMatchObject({ threads: { upsert: [expect.objectContaining({ threadId: 't2', quote: 'Title big' })] } });
  });

  it('(fix wave 1, 5) refuses to restore a version whose frames break the cap, before writing, and never clamps in afterRestore', () => {
    const live = design();
    const old = design([{ id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 } }]);
    transact(old, () => writeBoardEntry(old, 'b1', { w: 16_384, h: 8192 })); // a legacy state no writer of this build makes
    expect(() => adapter.revertScope!(live, old, { artifactId: 'd1' })).toThrow('the version cannot be restored: board b1: 16384×8192 is 134217728 px (over 67108864 px)');
    transact(old, () => writeBoardEntry(old, 'b1', { w: undefined }));
    expect(() => adapter.revertScope!(live, old, { artifactId: 'd1' })).toThrow('the version cannot be restored: board b1: a frame has x, y, w and h');
    expect(adapter.revertScope!(live, design(), { artifactId: 'd1' })).toMatchObject({ keep: expect.anything() });
    // afterRestore is C's alone: a frame it finds is left as it is (the refusal above is the restore's guard)
    const odd = design([{ id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 } }]);
    transact(odd, () => writeBoardEntry(odd, 'b1', { w: 16_384, h: 8192 }));
    adapter.afterRestore!(odd, { artifactId: 'd2', versionId: 1 });
    expect(boardFrame(odd, 'b1')).toEqual({ x: 0, y: 0, w: 16_384, h: 8192 });
  });

  it('keeps the conversations a restore would take back (C’s revertScope and afterRestore)', () => {
    expect(adapter.revertScope).toBeTypeOf('function');
    expect(adapter.afterRestore).toBeTypeOf('function');
    expect(adapter.beforeApply).toBeTypeOf('function');
  });
});

describe('summarizeDesignTurn', () => {
  it('counts boards added, changed and removed over a turn’s publishes, then the thread lines', () => {
    const b = (id: string) => boardPath(id);
    expect(summarizeDesignTurn([{ changed: [CANVAS_PATH, b('a'), b('b')], added: [b('a')], removed: [] }, { changed: [CANVAS_PATH], removed: [b('c')] }, { line: 'Replied to thread t1' }])).toBe('Published 3 boards (1 changed, 1 added, 1 removed)\nReplied to thread t1');
    expect(summarizeDesignTurn([{ changed: [CANVAS_PATH], removed: [] }])).toBe('Published the design’s canvas');
    expect(summarizeDesignTurn([{ changed: [], removed: [] }])).toBe('Published the design');
    expect(summarizeDesignTurn([{ changed: [b('a')], added: [b('a')] }, { changed: [], removed: [b('a')] }])).toBe('Published the design');
    expect(summarizeDesignTurn([{ line: 'Resolved thread t1' }])).toBe('Resolved thread t1');
  });
});


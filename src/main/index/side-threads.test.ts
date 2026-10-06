// The side-thread rows (E3 execution document, Design §5, Interfaces "Index migration 4"): one per thread, keyed by the
// child, mirroring its `opened` and `summarised` events so both are re-synthesised with the ids and times the live run
// emitted.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';

describe('SideThreadStore', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let parent: AppSessionId;
  let child: AppSessionId;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    parent = index.sessions.upsertFromSummary(summary()).record.appId;
    child = index.sessions.upsertFromSummary(summary()).record.appId;
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  it('writes the opened row once and answers it as stored', () => {
    expect(index.sideThreads.opened(child, parent, 't1')).toEqual({
      childAppSessionId: child, parentAppSessionId: parent, openedAt: 't1', summarisedAt: null, text: null, isError: false, turns: 0, lastTurnEventId: null,
    });
    expect(index.sideThreads.opened(child, parent, 't2').openedAt).toBe('t1');
    expect(index.sideThreads.of(parent).map((row) => row.childAppSessionId)).toEqual([child]);
    expect(index.sideThreads.of(child)).toEqual([]);
  });

  it('counts each turn once by its event id, and keeps the previous text when a turn ends without one', () => {
    index.sideThreads.opened(child, parent, 't1');
    expect(index.sideThreads.summarised(child, { id: 'e1', at: 't2', text: 'First answer.', isError: false })).toMatchObject({ turns: 1, text: 'First answer.', summarisedAt: 't2' });
    expect(index.sideThreads.summarised(child, { id: 'e1', at: 't2', text: 'First answer.', isError: false })).toBeNull(); // a repeated batch
    expect(index.sideThreads.summarised(child, { id: 'e2', at: 't3', text: null, isError: true })).toMatchObject({ turns: 2, text: 'First answer.', isError: true, summarisedAt: 't3', lastTurnEventId: 'e2' });
    expect(index.sideThreads.get(child)).toMatchObject({ turns: 2 });
  });

  it('answers null for a thread with no row', () => {
    expect(index.sideThreads.summarised(child, { id: 'e1', at: 't2', text: 'x', isError: false })).toBeNull();
    expect(index.sideThreads.get(child)).toBeNull();
  });

  it('goes with the child record', () => {
    index.sideThreads.opened(child, parent, 't1');
    index.sessions.remove(child);
    expect(index.sideThreads.of(parent)).toEqual([]);
  });

  it('lists a parent’s threads in the order they opened', () => {
    const second = index.sessions.upsertFromSummary(summary()).record.appId;
    index.sideThreads.opened(second, parent, 't5');
    index.sideThreads.opened(child, parent, 't1');
    expect(index.sideThreads.of(parent).map((row) => row.childAppSessionId)).toEqual([child, second]);
  });
});

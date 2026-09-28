import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReplayFixtureSchema } from '@shared/ipc/schema/session';
import { tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';

describe('replay fixtures in the index', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  it('adds one row per path, lists them, and records the last play', () => {
    const journal = index.fixtures.add({ name: 'workflow', kind: 'journal', path: '/fixtures/pass2/workflow.jsonl', sessionId: null });
    expect(ReplayFixtureSchema.parse(journal)).toEqual(journal);
    expect(index.fixtures.add({ name: 'again', kind: 'journal', path: '/fixtures/pass2/workflow.jsonl', sessionId: null })).toEqual(journal);
    const transcript = index.fixtures.add({ name: 'subagent-parent', kind: 'transcript', path: '/fixtures/subagent-parent.jsonl', sessionId: '9a1d4262' });
    expect(index.fixtures.list()).toEqual([journal, transcript]);
    index.fixtures.markPlayed(journal.id, '2026-09-28T12:00:00.000Z');
    expect(index.fixtures.list()[0].lastPlayedAt).toBe('2026-09-28T12:00:00.000Z');
  });
});

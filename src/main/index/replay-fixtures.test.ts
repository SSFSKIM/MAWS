import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReplayFixtureSchema } from '@shared/ipc/schema/session';
import { FIXTURE_DIR, listJournals } from '../../../test/support/fixtures';
import { tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import { appRoot, seedReplayFixtures } from './replay-fixtures';

const REPO_ROOT = join(__dirname, '../../..');

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

  it('seeds the probe journals and C4\'s transcripts that exist under a checkout, once each', () => {
    seedReplayFixtures(index.fixtures, REPO_ROOT);
    const fixtures = index.fixtures.list();
    const journals = fixtures.filter((f) => f.kind === 'journal');
    const transcripts = fixtures.filter((f) => f.kind === 'transcript');
    // Every probe journal of both passes, and nothing under the fixtures tree that is not a journal (the sidecar
    // transcripts, the workflow's own on-disk journal).
    const expected = [...listJournals('pass1').map((name) => join(FIXTURE_DIR, `${name}.jsonl`)), ...listJournals('pass2').map((name) => join(FIXTURE_DIR, 'pass2', `${name}.jsonl`))];
    expect(journals.map((f) => f.path).sort()).toEqual(expected.sort());
    expect(journals.find((f) => f.path.endsWith('pass2/workflow.jsonl'))).toMatchObject({ name: 'workflow', lastPlayedAt: null });
    expect(journals.find((f) => f.name === 'subagent')?.sessionId).toBe('9a1d4262-0b43-46ad-acb9-5982f31d209c');
    expect(transcripts.map((f) => f.name).sort()).toEqual(['rewind-real', 'subagent-parent', 'torn-tail']);
    expect(transcripts.find((f) => f.name === 'subagent-parent')?.sessionId).toBe('9a1d4262-0b43-46ad-acb9-5982f31d209c');
    for (const fixture of fixtures) expect(existsSync(fixture.path), fixture.path).toBe(true);

    // Idempotent; a checkout without the fixture trees (a packaged app) seeds nothing.
    seedReplayFixtures(index.fixtures, REPO_ROOT);
    expect(index.fixtures.list()).toEqual(fixtures);
    seedReplayFixtures(index.fixtures, join(dir.path, 'no-checkout'));
    expect(index.fixtures.list()).toEqual(fixtures);
  });

  it('finds the checkout above the app path the app was started with', () => {
    expect(appRoot(join(REPO_ROOT, 'out/main'))).toBe(REPO_ROOT);
    expect(appRoot(REPO_ROOT)).toBe(REPO_ROOT);
    expect(appRoot('/')).toBe('/');
  });
});

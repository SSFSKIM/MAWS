// The spine's profile-sized fixture (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, D19): written
// through the index's own API and the prompt history's file, it holds exactly the counts it is asked for, and the same
// seed writes the same records twice.
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { Index } from '../../src/services/index/index';
import { tempDir } from './index-fixture';
import { PROFILE_SIZED, writeSpineFixture, type SpineFixtureCounts } from './spine-fixture';

const SMALL: SpineFixtureCounts = { sessions: 60, projects: 5, attention: 12, pending: 4, library: 20, drafts: 6, history: 30 };

describe('the spine fixture', () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir('maws-spine-fixture-');
  });
  afterEach(() => dir.dispose());

  const profileAt = (name: string) => {
    const profile = join(dir.path, name);
    mkdirSync(profile);
    return profile;
  };

  // What a profile holds, keyed by what the generator decides (an app id is minted by the index, a project id by its
  // store, and a record's creation time is the clock's): sessions by engine id, everything else by its session's.
  const contents = async (profile: string) => {
    const index = new Index(join(profile, 'index.sqlite'));
    try {
      const records = index.sessions.list({ includeArchived: true }).sort((a, b) => String(a.engineSessionId).localeCompare(String(b.engineSessionId)));
      const engineIdOf = new Map(records.map((record) => [record.appId as string, record.engineSessionId]));
      const projectOf = new Map(index.projects.list({ includeHidden: true }).map((project) => [project.id as string, project.directory]));
      const sessions = records.map((record) => ({ ...record, appId: null, createdAt: null, updatedAt: null, projectId: record.projectId === null ? null : projectOf.get(record.projectId) }));
      const attention = (await index.attention.list()).map((item) => ({ ...item, appSessionId: engineIdOf.get(item.appSessionId) }));
      const drafts = records.flatMap((record) => {
        const draft = index.drafts.get(record.appId);
        return draft === null ? [] : [{ session: record.engineSessionId, draft }];
      });
      const actor = (who: Actor) => (who.kind === 'session' ? { kind: who.kind, session: engineIdOf.get(who.appSessionId) } : who);
      const library = index.library.list().rows.map((row) => ({
        ...row, createdBy: actor(row.createdBy), lastEditor: actor(row.lastEditor),
        sessions: row.sessions.map((session) => ({ ...session, appSessionId: engineIdOf.get(session.appSessionId) })),
      }));
      return { sessions, attention, drafts, library, history: readFileSync(join(profile, 'prompt-history.jsonl'), 'utf8') };
    } finally {
      index.close();
    }
  };

  it('is the size of the owner’s profile by default (D19)', () => {
    expect(PROFILE_SIZED).toEqual({ sessions: 5_000, projects: 50, attention: 300, pending: 40, library: 1_000, drafts: 50, history: 2_000 });
  });

  it('writes the counts it is asked for, through the index and the prompt history, and answers them read back', async () => {
    const profile = profileAt('ud');
    const written = await writeSpineFixture({ profile, folders: join(dir.path, 'projects'), counts: SMALL });
    expect(written).toEqual(SMALL);

    const index = new Index(join(profile, 'index.sqlite'));
    try {
      const records = index.sessions.list({ includeArchived: true });
      expect(records).toHaveLength(SMALL.sessions);
      const projects = index.projects.list({ includeHidden: true });
      expect(projects).toHaveLength(SMALL.projects);
      expect(new Set(records.map((record) => record.projectId))).toEqual(new Set(projects.map((project) => project.id))); // every folder holds sessions
      const attention = await index.attention.list();
      expect(attention).toHaveLength(SMALL.attention);
      expect(attention.filter((item) => item.state === 'pending')).toHaveLength(SMALL.pending);
      expect(index.library.list().rows).toHaveLength(SMALL.library);
      expect(records.filter((record) => index.drafts.get(record.appId) !== null)).toHaveLength(SMALL.drafts);
    } finally {
      index.close();
    }
    const history = readFileSync(join(profile, 'prompt-history.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(history).toHaveLength(SMALL.history);
    expect(JSON.parse(history[0]!)).toEqual(expect.objectContaining({ display: expect.any(String), timestamp: expect.any(Number), project: expect.stringContaining(join(dir.path, 'projects')) }));
  });

  // P5 O3-D M6 (fix round 1): the disk matches the index, so an engine host's scan finds nothing to do
  it('with transcripts, writes each session’s transcript under the engine config, the row its stat and its text stamped ready', async () => {
    const profile = profileAt('ud');
    const config = join(dir.path, 'claude-config');
    await writeSpineFixture({ profile, folders: join(dir.path, 'projects'), counts: SMALL, transcripts: config });
    const index = new Index(join(profile, 'index.sqlite'));
    try {
      const bindings = index.sessions.bindings();
      expect(bindings).toHaveLength(SMALL.sessions);
      for (const { sessionId, appSessionId, size, mtimeMs } of bindings) {
        const transcriptPath = index.sessions.summaryOf(appSessionId)!.transcriptPath;
        expect(transcriptPath.startsWith(join(config, 'projects'))).toBe(true);
        const stat = statSync(transcriptPath);
        expect({ size, mtimeMs }, transcriptPath).toEqual({ size: stat.size, mtimeMs: stat.mtimeMs });
        expect(index.sessionSearch.current(appSessionId, sessionId, stat.size, stat.mtimeMs), 'its text indexed: no re-index').toBe(true);
      }
    } finally {
      index.close();
    }
    // the same seed, the same records but for their transcripts' stamps
    const plain = profileAt('plain');
    await writeSpineFixture({ profile: plain, folders: join(dir.path, 'projects'), counts: SMALL });
    const titles = async (at: string) => (await contents(at)).sessions.map((record) => [record.engineSessionId, record.directory, record.title]);
    expect(await titles(profile)).toEqual(await titles(plain));
  });

  it('writes the same records from the same seed, and others from another', async () => {
    const folders = join(dir.path, 'projects'); // one set of folders, so the records' directories compare
    const [first, second, other] = [profileAt('first'), profileAt('second'), profileAt('other')];
    await writeSpineFixture({ profile: first, folders, counts: SMALL });
    await writeSpineFixture({ profile: second, folders, counts: SMALL });
    await writeSpineFixture({ profile: other, folders, counts: SMALL, seed: 2 });
    const firstContents = await contents(first);
    expect(firstContents.sessions).toHaveLength(SMALL.sessions);
    expect(await contents(second)).toEqual(firstContents);
    expect((await contents(other)).sessions).not.toEqual(firstContents.sessions);
  });
});

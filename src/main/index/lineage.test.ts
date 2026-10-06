// X11 lineage in the index (E3 execution document, Design §3 and §4, Interfaces "Index migration 4"): written from a
// launch's intent and kept, and derived from the disk for `--fork-session` copies MAWS did not launch (A-16's rule: a
// transcript repeating another's root uuid is a fork of the family's earliest-born member), recomputed so a family
// converges whatever order discovery reads it in.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { Lineage } from '@shared/graph/session';
import { SessionRecordSchema } from '@shared/graph/session';
import { sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';

const ROOT = 'b1277739-a5e8-440b-99de-90dd59edf04f' as MessageUuid; // the fork child's root in p1-fork-session-flag.jsonl seq 40

describe('lineage in the index (X11)', () => {
  let dir: ReturnType<typeof tempDir>;
  let project: ReturnType<typeof tempDir>;
  let index: Index;
  let changed: AppSessionId[];
  beforeEach(() => {
    dir = tempDir();
    project = tempDir('maws-lineage-project-');
    index = new Index(join(dir.path, 'index.sqlite'));
    changed = [];
    index.sessions.onChange((record) => changed.push(record.appId));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    project.dispose();
  });

  const launch = (lineage: Lineage | null) =>
    index.sessions.createForLaunch({
      directory: project.path,
      additionalDirectories: [],
      worktree: null,
      model: { requested: null, resolved: null },
      effort: null,
      permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
      lineage,
    }).record;

  // a transcript in the project, born at `born` (ms), whose first message record is `root`
  const seen = (n: number, born: number, root: MessageUuid | null = ROOT) =>
    index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(n), directory: project.path, rootUuid: root, birthtimeMs: born })).record;
  const lineageOf = (appId: AppSessionId) => index.sessions.get(appId)!.lineage;
  const sourceOf = (appId: AppSessionId) => {
    const reader = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
    try {
      return (reader.prepare('SELECT lineage_source FROM sessions WHERE app_id = ?').get(appId) as { lineage_source: string | null }).lineage_source;
    } finally {
      reader.close();
    }
  };
  const forkOf = (original: { appId: AppSessionId; engineSessionId: SessionId | null }): Lineage => ({
    kind: 'fork',
    parentAppSessionId: original.appId,
    parentEngineSessionId: original.engineSessionId,
    openedBy: 'fork',
  });

  it('a launch with lineage carries it on its record, from the intent, before the engine runs', () => {
    const parent = seen(1, 1_000);
    const lineage: Lineage = {
      kind: 'side-thread',
      parentAppSessionId: parent.appId,
      parentEngineSessionId: parent.engineSessionId,
      anchor: { kind: 'file-line', locator: '/r/x.ts#L42', label: 'x.ts:42', path: '/r/x.ts', line: 42 },
      openedBy: 'comment',
    };
    const child = launch(lineage);
    expect(child.lineage).toEqual(lineage);
    expect(SessionRecordSchema.parse(index.sessions.get(child.appId))).toEqual(index.sessions.get(child.appId));
    expect(sourceOf(child.appId)).toBe('intent');
    expect(launch(null).lineage).toBeNull();
  });

  it('the disk rule: two forks of an original born first list under it; the original stays a root', () => {
    const a = seen(1, 1_000);
    const b = seen(2, 2_000);
    const c = seen(3, 3_000);
    expect(lineageOf(a.appId)).toBeNull();
    expect(lineageOf(b.appId)).toEqual(forkOf(a));
    expect(lineageOf(c.appId)).toEqual(forkOf(a));
    expect(sourceOf(b.appId)).toBe('disk');
    expect(SessionRecordSchema.parse(index.sessions.get(b.appId))).toEqual(index.sessions.get(b.appId));
  });

  it('converges whatever the discovery order: C, then B, then the original A end as A first', () => {
    const c = seen(3, 3_000);
    expect(lineageOf(c.appId)).toBeNull(); // a family of one
    const b = seen(2, 2_000);
    expect(lineageOf(c.appId)).toEqual(forkOf(b)); // briefly a fork of its sibling
    expect(lineageOf(b.appId)).toBeNull();
    changed.length = 0;
    const a = seen(1, 1_000);
    expect(lineageOf(a.appId)).toBeNull();
    expect(lineageOf(b.appId)).toEqual(forkOf(a));
    expect(lineageOf(c.appId)).toEqual(forkOf(a)); // re-pointed
    expect(new Set(changed)).toEqual(new Set([a.appId, b.appId, c.appId]));
    // a summary that changes nothing of the family changes no lineage
    changed.length = 0;
    index.sessions.upsertFromSummary({ ...index.sessions.summaryOf(b.appId)!, size: 999 });
    expect(changed).toEqual([b.appId]);
  });

  it('a lineage from an intent survives the rule; a side thread of the original keeps its kind and anchor', () => {
    const a = seen(1, 1_000);
    const lineage: Lineage = { kind: 'side-thread', parentAppSessionId: a.appId, parentEngineSessionId: a.engineSessionId, openedBy: 'btw' };
    const thread = launch(lineage);
    const engineId = sessionIdFor(2);
    index.sessions.bindEngineId(thread.appId, engineId);
    index.sessions.upsertFromSummary(summary({ sessionId: engineId, directory: project.path, rootUuid: ROOT, birthtimeMs: 2_000 }));
    seen(3, 3_000);
    expect(lineageOf(thread.appId)).toEqual(lineage);
    expect(sourceOf(thread.appId)).toBe('intent');
  });

  it('an original whose disk lineage came from an earlier pass loses it; an intent-filled original keeps its own', () => {
    const b = seen(2, 2_000);
    const c = seen(3, 3_000);
    expect(lineageOf(c.appId)).toEqual(forkOf(b));
    // an earlier-born member arrives: B was the original, C pointed at it; now both point at A
    const a = seen(1, 1_000);
    expect(lineageOf(b.appId)).toEqual(forkOf(a));
    // a family whose earliest member MAWS launched with lineage keeps that lineage on the original
    const other = '11111111-2222-4333-8444-555555555555' as MessageUuid;
    const thread = launch({ kind: 'side-thread', parentAppSessionId: a.appId, parentEngineSessionId: a.engineSessionId, openedBy: 'btw' });
    index.sessions.bindEngineId(thread.appId, sessionIdFor(10));
    index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(10), directory: project.path, rootUuid: other, birthtimeMs: 500 }));
    const later = seen(11, 5_000, other);
    expect(lineageOf(thread.appId)?.kind).toBe('side-thread');
    expect(lineageOf(later.appId)).toEqual(forkOf(index.sessions.get(thread.appId)!));
  });

  it('ties of birth time go by creation; a transcript with no root uuid is in no family', () => {
    const a = seen(1, 0); // a filesystem with no birth time reports 0
    const b = seen(2, 0);
    expect(lineageOf(b.appId)).toEqual(forkOf(a));
    expect(lineageOf(seen(3, 9_000, null).appId)).toBeNull();
  });

  it('families are per project: the same root in another project is another family', () => {
    const a = seen(1, 1_000);
    const elsewhere = tempDir('maws-lineage-other-');
    try {
      const away = index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(2), directory: elsewhere.path, rootUuid: ROOT, birthtimeMs: 2_000 })).record;
      expect(away.projectId).not.toBe(a.projectId);
      expect(lineageOf(away.appId)).toBeNull();
    } finally {
      elsewhere.dispose();
    }
  });

  it('with no project, a family is the sessions of one directory', () => {
    const at = (n: number, directory: string, born: number) =>
      index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(n), directory, rootUuid: ROOT, birthtimeMs: born })).record;
    const a = at(1, '/nowhere/one', 1_000);
    const b = at(2, '/nowhere/one', 2_000);
    const c = at(3, '/nowhere/two', 3_000);
    expect(a.projectId).toBeNull();
    expect(lineageOf(b.appId)).toEqual(forkOf(a));
    expect(lineageOf(c.appId)).toBeNull();
  });

  it('a /clear rebind keeps the app id’s intent lineage; the old transcript is its own record, read by the disk rule', () => {
    const a = seen(1, 1_000);
    const lineage: Lineage = { kind: 'fork', parentAppSessionId: a.appId, parentEngineSessionId: a.engineSessionId, openedBy: 'fork' };
    const fork = launch(lineage);
    const first = sessionIdFor(2);
    index.sessions.bindEngineId(fork.appId, first);
    index.sessions.upsertFromSummary(summary({ sessionId: first, directory: project.path, rootUuid: ROOT, birthtimeMs: 2_000 }));
    index.sessions.bindEngineId(fork.appId, sessionIdFor(3)); // the engine's /clear
    expect(lineageOf(fork.appId)).toEqual(lineage);
    const old = index.sessions.getByEngineId(first)!;
    expect(old.appId).not.toBe(fork.appId);
    expect(old.lineage).toEqual(forkOf(a)); // the copied transcript is a fork of A by its root, not the app id's lineage
    // the new transcript has a root of its own: the app id is in no family with the old one
    index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(3), directory: project.path, rootUuid: '99999999-2222-4333-8444-555555555555' as MessageUuid, birthtimeMs: 4_000 }));
    expect(lineageOf(fork.appId)).toEqual(lineage);
    expect(lineageOf(old.appId)).toEqual(forkOf(a));
  });

  it('a /clear rebind drops a disk lineage with the old transcript', () => {
    const a = seen(1, 1_000);
    const b = seen(2, 2_000);
    index.sessions.applyEngineStatus(b.appId, { holder: { kind: 'self' } }); // a MAWS process holds it, so it is not bare
    index.sessions.bindEngineId(b.appId, sessionIdFor(3));
    expect(lineageOf(b.appId)).toBeNull();
    expect(index.sessions.getByEngineId(sessionIdFor(2))!.lineage).toEqual(forkOf(a));
  });

  it('a launch takes over the record discovery made for its transcript first, and keeps its intent lineage', () => {
    const a = seen(1, 1_000);
    const lineage: Lineage = { kind: 'side-thread', parentAppSessionId: a.appId, parentEngineSessionId: a.engineSessionId, openedBy: 'btw' };
    const thread = launch(lineage);
    const bare = seen(2, 2_000); // discovery read the child's transcript before the status naming it
    expect(lineageOf(bare.appId)).toEqual(forkOf(a));
    index.sessions.bindEngineId(thread.appId, sessionIdFor(2));
    expect(index.sessions.get(bare.appId)).toBeNull();
    expect(lineageOf(thread.appId)).toEqual(lineage);
  });

  // M2's review: a summary stored before migration 4 has neither field; a /clear rebind re-upserts it unvalidated
  it('a /clear rebind re-upserts a summary stored before v4 without its root fields, and leaves it for the next scan', () => {
    const lineage: Lineage = { kind: 'fork', parentAppSessionId: seen(1, 1_000).appId, parentEngineSessionId: sessionIdFor(1), openedBy: 'fork' };
    const fork = launch(lineage);
    const first = sessionIdFor(2);
    index.sessions.bindEngineId(fork.appId, first);
    index.sessions.upsertFromSummary(summary({ sessionId: first, directory: project.path, rootUuid: ROOT, birthtimeMs: 2_000 }));
    const writer = new DatabaseSync(join(dir.path, 'index.sqlite'));
    try {
      writer.exec("UPDATE sessions SET summary = json_remove(summary, '$.rootUuid', '$.birthtimeMs') WHERE engine_session_id = '" + first + "'");
    } finally {
      writer.close();
    }
    expect(() => index.sessions.bindEngineId(fork.appId, sessionIdFor(3))).not.toThrow();
    const old = index.sessions.getByEngineId(first)!;
    expect(old.lineage).toBeNull(); // no root read yet: in no family
    expect(index.sessions.bindings().find((b) => b.appSessionId === old.appId)).toMatchObject({ size: null, mtimeMs: null }); // re-read at the next scan
    expect(lineageOf(fork.appId)).toEqual(lineage);
  });

  it('deleting the original re-points its forks at the next-born member', () => {
    const a = seen(1, 1_000);
    const b = seen(2, 2_000);
    const c = seen(3, 3_000);
    index.sessions.remove(a.appId);
    expect(lineageOf(b.appId)).toBeNull();
    expect(lineageOf(c.appId)).toEqual(forkOf(b));
  });
});

// P3-E1 M2 (the parent's Decision Log 11 (1); acceptance 1's legacy half): A's `ArtifactStore.ensureMigrated` over the
// design adapter's `migrate`, on A's real store and SQLite file across a restart. A design an earlier build stored as
// generic files migrates once, in one committed row credited to the actor whose access triggered it; a second access,
// a concurrent one and one after a restart write nothing; its retained versions still read as the files they were;
// malformed input and a read-only store refuse by name with every file kept; a restore that brings back a legacy state
// migrates inside the restore's frame, keeping later conversations, and a restore that could not migrate is refused
// before anything is written.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardPath, CANVAS_PATH } from '@artifacts/design/canvas';
import { boardFrame, designFiles } from '@artifacts/design/model';
import { isLegacyDesign } from '@artifacts/design/migrate';
import { publishFiles, readFiles } from '@artifacts/files';
import { slideOrder } from '@artifacts/slides/model';
import { addThread, reply, threadStates } from '@artifacts/slides/threads';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { openDocuments, type Documents } from '../documents';
import { ArtifactStoreError } from '../documents/errors';
import { registerDesigns, type Designs } from '.';
import { AGENT, LEGACY_FILES, logRows, makeLegacyDesign, markNewer } from './legacy.fixture';

const HUMAN: Actor = { kind: 'human' };
const OTHER: Actor = { kind: 'session', appSessionId: 'app-other' as AppSessionId };

let userData: string;
let documents: Documents;
let designs: Designs;
const start = () => {
  documents = openDocuments(userData, () => {})!;
  designs = registerDesigns({ documents, chain: null, refresh: () => {} });
};
const stop = () => {
  designs.close();
  documents.close();
};
const restart = () => {
  stop();
  start();
};
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-design-migrate-'));
});
afterEach(() => {
  stop();
  rmSync(userData, { recursive: true, force: true });
});

/** The committed state as a fresh replica holds it. */
function stateOf(id: string): Doc {
  const doc = newDoc();
  applyV2(doc, documents.service.readState(id).state);
  return doc;
}
async function refusalOf(run: Promise<unknown>): Promise<ArtifactStoreError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactStoreError);
    return error as ArtifactStoreError;
  }
  throw new Error('not refused');
}

describe('ensureMigrated on a design an earlier build stored as generic files', () => {
  it('migrates once, in one row credited to the triggering actor, before it resolves; again, after a restart, writes nothing', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    expect(logRows(userData, id).map((r) => r.actor)).toEqual(['session:app-legacy']);
    await documents.store.ensureMigrated(id, OTHER);
    const rows = logRows(userData, id); // committed by the time it resolved
    expect(rows.map((r) => r.actor)).toEqual(['session:app-legacy', 'session:app-other']);
    const doc = stateOf(id);
    expect(readFiles(doc)).toEqual({}); // the generic root emptied, not deleted
    expect(slideOrder(doc)).toEqual(['phone', 'poster']);
    expect(boardFrame(doc, 'poster')).toEqual({ x: 500, y: 0, w: 1080, h: 10_000 });
    expect(Object.keys(designFiles(doc))).toEqual([CANVAS_PATH, boardPath('phone'), boardPath('poster')]);

    const revision = documents.store.revision(id);
    await documents.store.ensureMigrated(id, HUMAN);
    restart();
    await documents.store.ensureMigrated(id, HUMAN);
    expect(logRows(userData, id)).toEqual(rows);
    expect(documents.store.revision(id)).toBe(revision);
  });

  it('shares one migration among concurrent accesses, credited to the first', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    await Promise.all([documents.store.ensureMigrated(id, OTHER), documents.store.ensureMigrated(id, HUMAN), documents.store.ensureMigrated(id, AGENT)]);
    expect(logRows(userData, id).map((r) => r.actor)).toEqual(['session:app-legacy', 'session:app-other']);
  });

  it('keeps a retained version reading as the files it was', async () => {
    const { id, versionId } = await makeLegacyDesign(userData, { version: true });
    start();
    await documents.store.ensureMigrated(id, HUMAN);
    const old = newDoc();
    applyV2(old, documents.store.versionState(id, versionId!));
    expect(documents.service.adapterFor('design')!.readFiles!(old)).toEqual(LEGACY_FILES);
    expect(slideOrder(old)).toEqual([]); // never migrated
  });

  it('refuses malformed input by name each time, writing nothing and keeping every file', async () => {
    const files = { ...LEGACY_FILES, [CANVAS_PATH]: '{"v":1,"boards":' };
    const { id } = await makeLegacyDesign(userData, { files });
    start();
    for (let i = 0; i < 2; i++) {
      const error = await refusalOf(documents.store.ensureMigrated(id, HUMAN));
      expect(error.code).toBe('invalid');
      expect(error.message).toMatch(new RegExp(`design ${id}.*project/canvas\\.json is not JSON`));
      expect(error.data).toMatchObject({ artifactId: id, problems: [expect.objectContaining({ path: CANVAS_PATH })] });
    }
    expect(logRows(userData, id)).toHaveLength(1);
    expect(readFiles(stateOf(id))).toEqual(files);
  });

  it('refuses by name on a read-only store when a migration is needed, and lets a migrated design through', async () => {
    const legacy = await makeLegacyDesign(userData);
    const migrated = await makeLegacyDesign(userData);
    start();
    await documents.store.ensureMigrated(migrated.id, HUMAN);
    stop();
    markNewer(userData);
    start();
    expect(documents.storage.readOnly).toBe(true);
    const error = await refusalOf(documents.store.ensureMigrated(legacy.id, HUMAN));
    expect(error.code).toBe('invalid');
    expect(error.message).toMatch(/read-only/);
    await documents.store.ensureMigrated(migrated.id, HUMAN);
    expect(logRows(userData, legacy.id)).toHaveLength(1);
  });

  it('does nothing for another kind, a deleted design or no artifact', async () => {
    start();
    const deck = await documents.store.create({ kind: 'document', title: 'Notes' }, HUMAN);
    const rows = logRows(userData, deck.id);
    await documents.store.ensureMigrated(deck.id, HUMAN);
    await documents.store.ensureMigrated('55555555-5555-4555-8555-555555555555', HUMAN);
    expect(logRows(userData, deck.id)).toEqual(rows);
  });
});

describe('a restore that brings a legacy state back', () => {
  it('migrates it inside the restore’s own frame as the restorer, keeping the conversation since the version', async () => {
    const { id, versionId } = await makeLegacyDesign(userData, { version: true });
    start();
    await documents.store.ensureMigrated(id, AGENT);
    await documents.service.writeAs(id, HUMAN, (doc) => addThread(doc, { threadId: 't1', slideId: 'phone', elementId: 't', quote: 'Sign in', by: HUMAN, at: 1, body: 'Bigger?' }));
    await documents.service.writeAs(id, OTHER, (doc) => reply(doc, 't1', { id: 't1:m1', by: OTHER, at: 2, body: 'Done.' }));
    const before = logRows(userData, id).length;

    const restored = await documents.store.restore(id, versionId!, HUMAN);
    const rows = logRows(userData, id);
    // the revert and its after-effects (the migration among them) in the restore's one frame, as the restorer
    expect(rows.slice(before).map((r) => r.actor)).toEqual(rows.slice(before).map(() => 'human'));
    expect(rows.at(-1)!.seq).toBe(restored.revision);
    const doc = stateOf(id);
    expect(readFiles(doc)).toEqual({});
    expect(slideOrder(doc)).toEqual(['phone', 'poster']);
    const [thread] = threadStates(doc);
    expect(thread).toMatchObject({ id: 't1', orphan: false, slideId: 'phone', elementId: 't' });
    expect(thread!.messages.map((m) => m.body)).toEqual(['Bigger?', 'Done.']);
    // the version the restore wrote reads the model, and a later access writes nothing
    await documents.store.ensureMigrated(id, OTHER);
    expect(logRows(userData, id)).toEqual(rows);
  });

  it('is refused before it writes when the legacy version could not migrate', async () => {
    const { id, versionId } = await makeLegacyDesign(userData, { files: { ...LEGACY_FILES, [CANVAS_PATH]: 'not json' }, version: true });
    start();
    await documents.service.writeAs(id, AGENT, (doc) => void publishFiles(doc, readFiles(doc), { [CANVAS_PATH]: LEGACY_FILES[CANVAS_PATH]! }, false)); // an earlier build's fix
    await documents.store.ensureMigrated(id, AGENT);
    const rows = logRows(userData, id);
    const files = designFiles(stateOf(id));
    await expect(documents.store.restore(id, versionId!, HUMAN)).rejects.toThrow(/canvas\.json is not JSON/);
    expect(logRows(userData, id)).toEqual(rows);
    expect(designFiles(stateOf(id))).toEqual(files);
  });
});

describe('a no-op certified only once committed (M2 fix wave)', () => {
  it('does not trust a restore’s in-frame migration whose commit fails: the next access migrates the state that stands', async () => {
    const { id, versionId } = await makeLegacyDesign(userData, { version: true });
    start();
    // an access arriving while the restore's batch (its migration of the legacy version inside) waits to commit, and
    // that commit failing
    let concurrent: Promise<void> | null = null;
    const off = documents.service.onBeforeCommit((ids) => {
      const live = documents.service.loaded(id);
      if (concurrent || !ids.includes(id) || !live || isLegacyDesign(live)) return;
      concurrent = documents.store.ensureMigrated(id, OTHER);
      concurrent.catch(() => {});
    });
    const commit = documents.storage.commit.bind(documents.storage);
    let failed = false;
    const spy = vi.spyOn(documents.storage, 'commit').mockImplementation(() => {
      if (concurrent && !failed) {
        failed = true;
        throw new Error('disk full');
      }
      commit();
    });
    const error = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(documents.store.restore(id, versionId!, HUMAN)).rejects.toThrow();
    expect(failed).toBe(true);
    await expect(concurrent!).rejects.toThrow(/failed to commit/); // nothing certified from rows a failed batch took back
    spy.mockRestore();
    error.mockRestore();
    off();

    expect(readFiles(stateOf(id))).toEqual(LEGACY_FILES); // the durable state: still the earlier build's
    await documents.store.ensureMigrated(id, HUMAN);
    const doc = stateOf(id);
    expect(readFiles(doc)).toEqual({});
    expect(slideOrder(doc)).toEqual(['phone', 'poster']);
    expect(logRows(userData, id).map((r) => r.actor)).toEqual(['session:app-legacy', 'human']);
  });
});

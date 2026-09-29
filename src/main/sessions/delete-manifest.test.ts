import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { tempDir } from '../../../test/support/index-fixture';
import { DeletionManifests, enumerateConversation } from './delete-manifest';

const SID = '5f0c4a8e-2b1d-4c3e-9a7f-6e5d4c3b2a19' as SessionId;
const OTHER = '5f0c4a8e-2b1d-4c3e-9a7f-6e5d4c3b2a20' as SessionId;
const APP = '11111111-1111-4111-8111-111111111111' as AppSessionId;

describe('delete manifest', () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir('maws-delete-');
  });
  afterEach(() => dir.dispose());

  it('enumerates recordings, siblings, the sidecar directory and the transcript last, only what exists and only this session', async () => {
    const project = join(dir.path, 'projects', '-work');
    mkdirSync(join(project, SID, 'subagents'), { recursive: true });
    for (const name of [`${SID}.jsonl`, `${SID}.precompact.json`, `${SID}-20260928T120000.cast`, `${SID}-b.cast`, `${OTHER}.jsonl`, `${OTHER}-x.cast`, `${SID}.cast`, `${SID}-sub/x.cast`.split('/')[0]]) {
      if (name === `${SID}-sub`) mkdirSync(join(project, name));
      else writeFileSync(join(project, name), '');
    }
    const paths = await enumerateConversation(project, SID);
    expect(paths).toEqual([
      join(project, `${SID}-20260928T120000.cast`),
      join(project, `${SID}-b.cast`),
      join(project, `${SID}.precompact.json`), // the .ccr-tip.json sibling does not exist and is not listed
      join(project, SID),
      join(project, `${SID}.jsonl`),
    ]);
  });

  it('answers nothing for a project directory that is gone', async () => {
    expect(await enumerateConversation(join(dir.path, 'nowhere'), SID)).toEqual([]);
  });

  it('persists a manifest before the first move, records what moved, and forgets it', async () => {
    const manifests = new DeletionManifests(join(dir.path, 'deletions'));
    const manifest = { appSessionId: APP, engineSessionId: SID, paths: ['/a', '/b'], trashed: [], createdAt: '2026-09-29T00:00:00.000Z' };
    await manifests.put(manifest);
    expect(await manifests.list()).toEqual([manifest]);
    await manifests.put({ ...manifest, trashed: ['/a'] });
    expect(await manifests.get(APP)).toEqual({ ...manifest, trashed: ['/a'] });
    await manifests.remove(APP);
    expect(await manifests.get(APP)).toBeNull();
    expect(await manifests.list()).toEqual([]);
  });
});

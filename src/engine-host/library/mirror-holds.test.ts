// E3 M1 fix wave (task review finding 5; docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): L's mirror reads a
// dashboard's state and its asset list inside the read barrier and the snapshots' bytes later, as it writes them. The
// snapshots that state names are held from that read until the writing is done, so refreshes that retire one meanwhile,
// and the collection they let run, never leave the mirror half written (its markdown new, its snapshot missing, its
// manifest stale): the pass mirrors exactly the state it read, whole.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDataset } from '@artifacts/dashboard/datasets';
import { mirrorSlug } from '@artifacts/library/mirror';
import type { Actor } from '@shared/artifacts/actor';
import { openDocuments, type Documents } from '../documents';
import { registerDashboards, type Dashboards } from '../dashboards';
import { LibraryMirror } from './mirror';

const human: Actor = { kind: 'human' };
let userData: string;
let project: string;
let documents: Documents;
let dashboards: Dashboards;
let mirror: LibraryMirror;
const logged: string[] = [];

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'maws-mirror-holds-'));
  project = mkdtempSync(join(tmpdir(), 'maws-mirror-holds-project-'));
  documents = openDocuments(userData, () => {})!;
  dashboards = registerDashboards({ documents });
  logged.length = 0;
  mirror = new LibraryMirror(documents, { log: (line) => logged.push(line) });
  await mirror.start();
});
afterEach(() => {
  mirror.close();
  dashboards.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

let serial = 0;
function refresh(artifactId: string): Promise<number> {
  let ref = '';
  const at = Date.now();
  serial += 1;
  return documents.store.writeWithAssets(
    artifactId,
    human,
    [{ bytes: new TextEncoder().encode(`[{"v":${serial}}]`), name: `query-${randomUUID()}.json`, mime: 'application/json', querySnapshot: true }],
    (doc, refs) => {
      ref = refs[0]!.ref;
      setDataset(doc, 'live', { title: 'Live', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: human }, state: { status: 'ok', at } });
    },
    { inFrame: (revision) => documents.store.retainQuerySnapshots(artifactId, 'live', ref, revision) },
  );
}

describe('the mirror over a refreshing dashboard (E3)', () => {
  it('holds the snapshots of the state it read through its writing: a collection meanwhile never leaves it half written', async () => {
    const space = await documents.store.createSpace({ name: 'Data', linkedDir: project });
    const board = await documents.store.create({ kind: 'dashboard', title: 'Live board', spaceId: space.id }, human);
    await refresh(board.id);
    await mirror.flush();
    const slug = mirrorSlug(board);
    // the next pass reads the state naming snapshot 2; at that very read two refreshes retire it and a collection is asked
    await refresh(board.id);
    const readState = documents.service.readState.bind(documents.service);
    let raced = false;
    vi.spyOn(documents.service, 'readState').mockImplementation((artifactId) => {
      const read = readState(artifactId);
      if (!raced && artifactId === board.id) {
        raced = true;
        void refresh(board.id);
        void refresh(board.id);
        documents.store.collectRetiredAssets(board.id);
      }
      return read;
    });
    await mirror.flush();
    expect(raced).toBe(true);
    expect(logged.filter((line) => /failed|could not/.test(line))).toEqual([]); // no pass failed half-way
    const manifest = JSON.parse(readFileSync(join(project, 'artifacts', slug, 'datasets.json'), 'utf8'));
    const file = join(project, 'artifacts', slug, manifest.datasets.live.file);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([{ v: 4 }]); // the latest pass, whole
    vi.restoreAllMocks();
    documents.store.collectRetiredAssets(board.id); // the mirror let go of what it held
    expect(documents.store.listAssets(board.id).filter((asset) => asset.name.startsWith('query-'))).toHaveLength(2);
  });
});

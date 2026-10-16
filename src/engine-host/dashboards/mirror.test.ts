// A dashboard in a linked Space over a real store and L's mirror (P3-E2 M5; parent §2 "Exports", E's Decision Log 32):
// registered with the kind, the mirror writes the dashboard's dialect, its binding manifest and the bound snapshot's
// bytes read-only; a replacement writes the new snapshot under its own name and removes the old one; two snapshots
// uploaded under one file name (the store names the second anew) stay two files; deleting the dashboard removes all.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { snapshotFileName } from '@artifacts/dashboard/mirror';
import { mirrorSlug } from '@artifacts/library/mirror';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { openDocuments, type Documents } from '../documents';
import { CHANGE_COALESCE_MS } from '../documents/store';
import { LibraryMirror } from '../library/mirror';
import { registerDashboards, type Dashboards } from './index';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' as AppSessionId };
const bytes = (text: string) => new TextEncoder().encode(text);

let userData: string;
let project: string;
let documents: Documents;
let dashboards: Dashboards;
let mirror: LibraryMirror;

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'maws-dashboard-mirror-host-'));
  project = mkdtempSync(join(tmpdir(), 'maws-dashboard-mirror-project-'));
  documents = openDocuments(userData, () => {})!;
  dashboards = registerDashboards({ documents });
  mirror = new LibraryMirror(documents, { log: () => {} });
  await mirror.start();
});
afterEach(() => {
  mirror.close();
  dashboards.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

const out = (...parts: string[]) => join(project, 'artifacts', ...parts);
const listed = () => (existsSync(out()) ? readdirSync(out(), { recursive: true }).map(String).sort() : []);

async function bind(artifactId: string, opId: string, ref: string, csv: string, at: number): Promise<void> {
  const descriptor = {
    title: 'Sales',
    source: { kind: 'file', ref, name: 'sales.csv', format: 'csv', sha256: 'c'.repeat(64), size: csv.length },
    columns: [
      { name: 'region', type: 'string' },
      { name: 'total', type: 'number' },
    ],
    rows: csv.trim().split('\n').length - 1,
    updated: { at, by: agent },
    state: { status: 'ok', at },
  };
  await documents.store.testWrite(artifactId, opId, [{ op: 'setAttr', root: 'datasets', key: 'sales', value: descriptor }], agent);
}

describe('the dashboard’s mirror over a real store', () => {
  it('writes the dialect, the manifest and the snapshot; a replacement renames, two uploads of one name stay two', async () => {
    const space = await documents.store.createSpace({ name: 'Data', linkedDir: project });
    const board = await documents.store.create({ kind: 'dashboard', title: 'Sales board', spaceId: space.id }, human);
    const slug = mirrorSlug(board);
    const first = await documents.store.uploadAsset(board.id, bytes('region,total\nNorth,10\n'), { name: 'sales.csv', mime: 'text/csv' }, agent);
    const second = await documents.store.uploadAsset(board.id, bytes('region,total\nNorth,70\n'), { name: 'sales.csv', mime: 'text/csv' }, agent);
    expect(second.ref).not.toBe(first.ref);
    await bind(board.id, 'b1', first.ref, 'region,total\nNorth,10\n', Date.UTC(2026, 9, 1, 9));
    await mirror.flush();

    const oldName = `data/${snapshotFileName('sales.csv', first.ref, 'csv')}`;
    expect(readFileSync(out(slug, oldName), 'utf8')).toBe('region,total\nNorth,10\n');
    expect(statSync(out(slug, oldName)).mode & 0o777).toBe(0o444);
    const manifest = JSON.parse(readFileSync(out(slug, 'datasets.json'), 'utf8'));
    expect(manifest.datasets.sales).toMatchObject({ file: oldName, format: 'csv', snapshot: { ref: first.ref, updated: '2026-10-01T09:00:00.000Z' } });
    expect(existsSync(out(`${slug}.md`))).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50)); // the store's feed holds a second commit this long
    await bind(board.id, 'b2', second.ref, 'region,total\nNorth,70\n', Date.UTC(2026, 9, 2, 10, 30));
    await new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50));
    await mirror.flush();
    const newName = `data/${snapshotFileName('sales-2.csv', second.ref, 'csv')}`; // the store's own name for the second upload
    expect(newName).not.toBe(oldName);
    expect(readFileSync(out(slug, newName), 'utf8')).toBe('region,total\nNorth,70\n');
    expect(existsSync(out(slug, oldName))).toBe(false); // the replaced snapshot no longer mirrored, never reused
    expect(JSON.parse(readFileSync(out(slug, 'datasets.json'), 'utf8')).datasets.sales.file).toBe(newName);

    await documents.store.delete(board.id);
    await mirror.flush();
    expect(listed().filter((file) => file !== '.maws-mirror.json' && !file.startsWith('.'))).toEqual([]);
  });
});

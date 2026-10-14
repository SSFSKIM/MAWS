// An agent's finished download as a File artifact (P3-L M6b; E13 before it wrote an X12 record), over a real store in a
// temp directory.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { recordDownload } from './downloads';

const A = 'app-1' as AppSessionId;
let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let download: { appSessionId: AppSessionId; tabId: string; path: string; filename: string; url: string; bytes: number };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-library-downloads-'));
  storage = SqliteDocumentStorage.open(join(dir, 'artifacts', 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id) });
  store = new ArtifactStore(service, storage, { root: join(dir, 'artifacts'), log: () => {} });
  const path = join(dir, 'cua-report.pdf');
  writeFileSync(path, '%PDF-1.4');
  download = { appSessionId: A, tabId: 'b_000000000001', path, filename: 'cua-report.pdf', url: 'http://127.0.0.1:5000/report.pdf', bytes: 8 };
});
afterEach(() => {
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('recordDownload (M6b: an agent’s finished download as a File artifact)', () => {
  it('creates one File artifact for the path, in place, titled with the filename, made by the session and linked created', async () => {
    expect(await recordDownload(store, download)).toBe('recorded');
    const [artifact, ...more] = store.list();
    expect(more).toEqual([]);
    expect(artifact).toMatchObject({ kind: 'file', title: 'cua-report.pdf', linkedPath: download.path, createdBy: { kind: 'session', appSessionId: A } });
    expect(store.contentRef(artifact!.id).path).toBe(download.path);
    expect(store.links(artifact!.id).map((link) => [link.appSessionId, link.role])).toEqual([[A, 'created']]);
  });

  it('records a path once per session: a second report is a duplicate, two at once record it once, another session’s is its own', async () => {
    expect(await recordDownload(store, download)).toBe('recorded');
    expect(await recordDownload(store, { ...download, tabId: 'b_000000000002' })).toBe('duplicate');
    const other = { ...download, appSessionId: 'app-2' as AppSessionId };
    expect((await Promise.all([recordDownload(store, other), recordDownload(store, other)])).sort()).toEqual(['duplicate', 'recorded']);
    expect(store.list().map((artifact) => store.links(artifact.id)[0]!.appSessionId).sort()).toEqual([A, 'app-2']);
  });

  it('refuses a path that is no longer a file, recording nothing', async () => {
    await expect(recordDownload(store, { ...download, path: join(dir, 'gone.pdf') })).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
});

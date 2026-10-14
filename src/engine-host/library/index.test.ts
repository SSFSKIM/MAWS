// The library module as the engine host wires it (M2): the reads registered, the mirror started over the store at
// once (a linked Space's artifacts written at host start) and stopped by `close`.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mirrorSlug } from '@artifacts/library/mirror';
import { HostCommandError } from '@shared/host/runtime';
import { openDocuments, type Documents } from '../documents';
import { registerLibrary } from '.';
import { importSettled } from './import-gate';
import { MIRROR_SETTLE_MS } from './mirror';

let userData: string;
let project: string;
let documents: Documents;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
const on = (name: string, handler: unknown) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-library-host-'));
  project = mkdtempSync(join(tmpdir(), 'maws-library-project-'));
  documents = openDocuments(userData, () => {})!;
  handlers = new Map();
});
afterEach(() => {
  documents.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});
const until = async (test: () => boolean) => {
  for (let i = 0; i < 400 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(test()).toBe(true);
};

it('registers the reads and mirrors the linked Spaces from the start until it is closed', async () => {
  const space = await documents.store.createSpace({ name: 'Launch', linkedDir: project });
  const page = await documents.store.create({ kind: 'html', title: 'Page', spaceId: space.id, content: { bytes: new TextEncoder().encode('<p>x</p>') } }, { kind: 'human' });
  const library = registerLibrary(on, { documents, deliverablesDir: join(userData, 'deliverables') });
  expect([...handlers.keys()].sort()).toEqual(['library.entry', 'library.snapshot', 'library.testImport', 'library.text']);
  await until(() => existsSync(join(project, 'artifacts', `${mirrorSlug(page)}.html`)));

  library.close();
  await documents.store.update(page.id, { title: 'Renamed' });
  await new Promise((resolve) => setTimeout(resolve, MIRROR_SETTLE_MS + 200));
  expect(readdirSync(join(project, 'artifacts'))).toContain(`${mirrorSlug(page)}.html`); // no longer followed: the old name stays
});

it('answers `unavailable` and mirrors nothing without a store', async () => {
  const library = registerLibrary(on, { documents: null, deliverablesDir: join(userData, 'deliverables') });
  await expect(handlers.get('library.snapshot')!(undefined)).rejects.toBeInstanceOf(HostCommandError);
  library.close();
});

// M6b (Decision Log 5, 22b, 32b): the X12 import runs once at every host start over the store as it opened, with no
// marker: a start over records that all landed skips each by its id, and imported + skipped + missing + failed covers
// the directory.
describe('the X12 import at store open (M6b)', () => {
  const AT = '2026-09-01T10:00:00.000Z';
  function seed(appSessionId: string, id: string, file: string | null): void {
    const sessionDir = join(userData, 'deliverables', appSessionId);
    mkdirSync(sessionDir, { recursive: true });
    const path = join(project, `${id}.txt`);
    if (file !== null) writeFileSync(path, file);
    writeFileSync(join(sessionDir, `${id}.json`), JSON.stringify({ id, appSessionId, kind: 'file', path, title: `${id}.txt`, versions: [{ path, at: AT }], createdAt: AT }));
  }
  const uuid = (n: number) => `0f8e2a1c-4b3d-4e5f-8a7b-${n.toString(16).padStart(12, '0')}`;

  it('imports the records at open, logs the counts, and a second open skips them all', async () => {
    seed('app-1', uuid(1), 'one');
    seed('app-2', uuid(2), 'two');
    seed('app-2', uuid(3), null); // its file is gone: missing
    const lines: string[] = [];
    const first = registerLibrary(on, { documents, deliverablesDir: join(userData, 'deliverables'), log: (line) => lines.push(line) });
    await until(() => lines.some((line) => line.includes('imported 2')));
    expect(documents.store.get(uuid(1))).toMatchObject({ kind: 'file', title: `${uuid(1)}.txt` });
    expect(documents.store.links(uuid(2)).map((link) => [link.appSessionId, link.role])).toEqual([['app-2', 'created']]);
    expect(lines.find((line) => line.includes('imported 2'))).toMatch(/imported 2, skipped 0, missing 1, failed 0/);
    first.close();

    lines.length = 0;
    const second = registerLibrary(on, { documents, deliverablesDir: join(userData, 'deliverables'), log: (line) => lines.push(line) });
    await until(() => lines.some((line) => line.includes('skipped 2')));
    expect(lines.find((line) => line.includes('skipped 2'))).toMatch(/imported 0, skipped 2, missing 1, failed 0/);
    expect(documents.store.list().map((a) => a.id).sort()).toEqual([uuid(1), uuid(2)]);
    second.close();
  });

  it('`library.testImport` runs the import again under MAWS_E2E=1 only', async () => {
    const library = registerLibrary(on, { documents, deliverablesDir: join(userData, 'deliverables'), log: () => {} });
    await expect(handlers.get('library.testImport')!(undefined)).rejects.toThrow(/MAWS_E2E=1/);
    library.close();
    const lines: string[] = [];
    const e2e = registerLibrary(on, { documents, deliverablesDir: join(userData, 'deliverables'), log: (line) => lines.push(line), e2e: true });
    await until(() => lines.length > 0); // the import at open ran over an empty tree
    seed('app-1', uuid(4), 'four');
    expect(await handlers.get('library.testImport')!(undefined)).toEqual({ imported: 1, skipped: 0, missing: 0, failed: 0 });
    expect(documents.store.get(uuid(4))).toMatchObject({ kind: 'file' });
    e2e.close();
  });

  // Fix wave 1 (Decision Log 39a): no start-up window. The store's gate holds until the start import ends, however it
  // ends, and main's reads taken meanwhile answer with what it landed.
  it('holds the store’s gate until the start import lands, and a read taken at once answers with the imported record', async () => {
    seed('app-1', uuid(5), 'five');
    const lines: string[] = [];
    const library = registerLibrary(on, { documents, deliverablesDir: join(userData, 'deliverables'), log: (line) => lines.push(line) });
    const snapshot = handlers.get('library.snapshot')!(undefined) as Promise<{ artifacts: { id: string }[] }>;
    await importSettled(documents.store);
    expect(documents.store.get(uuid(5))).toMatchObject({ kind: 'file' });
    expect(lines.some((line) => line.includes('imported 1'))).toBe(true);
    expect((await snapshot).artifacts.map((a) => a.id)).toContain(uuid(5));
    library.close();
  });

  it('opens the gate when the start import fails, and logs why', async () => {
    writeFileSync(join(userData, 'not-a-directory'), 'x'); // a tree that cannot be listed: the import rejects
    const lines: string[] = [];
    const library = registerLibrary(on, { documents, deliverablesDir: join(userData, 'not-a-directory'), log: (line) => lines.push(line) });
    await importSettled(documents.store);
    await until(() => lines.some((line) => line.includes('did not run')));
    await expect(handlers.get('library.snapshot')!(undefined)).resolves.toMatchObject({ artifacts: expect.any(Array) });
    library.close();
  });
});

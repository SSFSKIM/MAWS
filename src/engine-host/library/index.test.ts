// The library module as the engine host wires it (M2): the reads registered, the mirror started over the store at
// once (a linked Space's artifacts written at host start) and stopped by `close`.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mirrorSlug } from '@artifacts/library/mirror';
import { HostCommandError } from '@shared/host/runtime';
import { openDocuments, type Documents } from '../documents';
import { registerLibrary } from '.';
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
  const library = registerLibrary(on, { documents });
  expect([...handlers.keys()].sort()).toEqual(['library.entry', 'library.snapshot', 'library.text']);
  await until(() => existsSync(join(project, 'artifacts', `${mirrorSlug(page)}.html`)));

  library.close();
  await documents.store.update(page.id, { title: 'Renamed' });
  await new Promise((resolve) => setTimeout(resolve, MIRROR_SETTLE_MS + 200));
  expect(readdirSync(join(project, 'artifacts'))).toContain(`${mirrorSlug(page)}.html`); // no longer followed: the old name stays
});

it('answers `unavailable` and mirrors nothing without a store', async () => {
  const library = registerLibrary(on, { documents: null });
  await expect(handlers.get('library.snapshot')!(undefined)).rejects.toBeInstanceOf(HostCommandError);
  library.close();
});

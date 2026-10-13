// The linked-directory mirror over a real store (the P3-L document, M2; Decision Log 12): a linked Space's artifacts
// written read-only under `<linkedDir>/artifacts/` after each change settles, the manifest owning exactly what the
// mirror wrote, and a host start bringing the directory up to date.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mirrorSlug, registerMirrorWriter, type MirrorOutput } from '@artifacts/library/mirror';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { openDocuments, type Documents } from '../documents';
import { CHANGE_COALESCE_MS } from '../documents/store';
import { LibraryMirror, MIRROR_MANIFEST } from './mirror';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' as AppSessionId };

let userData: string;
let project: string;
let documents: Documents;
let mirror: LibraryMirror | null;
let logs: string[];
const offs: (() => void)[] = [];

function startMirror(options: { settleMs?: number; maxFileBytes?: number } = {}): Promise<void> {
  mirror = new LibraryMirror(documents, { log: (line) => logs.push(line), ...options });
  return mirror.start();
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-mirror-host-'));
  project = mkdtempSync(join(tmpdir(), 'maws-mirror-project-'));
  documents = openDocuments(userData, () => {})!;
  logs = [];
  mirror = null;
});
afterEach(() => {
  for (const off of offs.splice(0)) off();
  mirror?.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

const store = () => documents.store;
const out = (...parts: string[]) => join(project, 'artifacts', ...parts);
const listed = () => (existsSync(out()) ? readdirSync(out(), { recursive: true }).map(String).sort() : []);
const read = (...parts: string[]) => readFileSync(out(...parts), 'utf8');
const mode = (...parts: string[]) => statSync(out(...parts)).mode & 0o777;
const manifest = () => JSON.parse(read(MIRROR_MANIFEST)) as { artifacts: Record<string, { files: string[] }> };
const html = (text: string) => ({ bytes: new TextEncoder().encode(`<p>${text}</p>`) });
const linkedSpace = (name = 'Launch', dir = project) => store().createSpace({ name, linkedDir: dir });
const until = async (test: () => boolean) => {
  for (let i = 0; i < 400 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(test()).toBe(true);
};
// A document kind's writer, as B's will be: the doc's root text as `<slug>.md`, counted per call.
function registerDocumentWriter(): { calls: string[] } {
  const calls: string[] = [];
  offs.push(
    registerMirrorWriter('document', ({ artifact, doc }) => {
      calls.push(artifact.title);
      return { files: { [`${mirrorSlug(artifact)}.md`]: doc!.get('root').toString() } };
    }),
  );
  return { calls };
}

describe('the linked-directory mirror (M2)', () => {
  it('writes an html artifact in a linked Space read-only after a write, and rewrites it after the next', async () => {
    await startMirror();
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: 'Launch page', spaceId: space.id, content: html('first') }, agent);
    await mirror!.flush();
    const name = `${mirrorSlug(page)}.html`;
    expect(listed()).toEqual([MIRROR_MANIFEST, name]);
    expect(read(name)).toBe('<p>first</p>');
    expect(mode(name)).toBe(0o444);
    expect(manifest().artifacts[page.id].files).toEqual([name]);

    await store().writeContent(page.id, html('second'), agent);
    await mirror!.flush();
    expect(read(name)).toBe('<p>second</p>');
    expect(mode(name)).toBe(0o444);
  });

  it('moves a renamed artifact’s file, the changes of one settle written once', async () => {
    const { calls } = registerDocumentWriter();
    await startMirror({ settleMs: 80 });
    const space = await linkedSpace();
    const doc = await store().create({ kind: 'document', title: 'Draft', spaceId: space.id }, human);
    await store().testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'body text' }], human);
    await until(() => listed().includes(`${mirrorSlug(doc)}.md`));
    calls.length = 0;

    for (const title of ['Draft 2', 'Draft 3', 'Final']) await store().update(doc.id, { title });
    await until(() => calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toEqual(['Final']);
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug({ id: doc.id, title: 'Final' })}.md`]);
    expect(read(`${mirrorSlug({ id: doc.id, title: 'Final' })}.md`)).toBe('body text');
  });

  it('removes exactly the manifest’s files when an artifact leaves the Space, is deleted or the Space is unlinked', async () => {
    await startMirror();
    const space = await linkedSpace();
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((title) => store().create({ kind: 'html', title, spaceId: space.id, content: html(title) }, agent)));
    mkdirSync(out(), { recursive: true });
    writeFileSync(out('notes.txt'), 'the owner’s own file');
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, ...[a, b, c].map((x) => `${mirrorSlug(x)}.html`), 'notes.txt'].sort());

    await store().update(a.id, { spaceId: null });
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(b)}.html`, `${mirrorSlug(c)}.html`, 'notes.txt'].sort());

    await store().delete(b.id);
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(c)}.html`, 'notes.txt'].sort());

    await store().updateSpace(space.id, { linkedDir: null });
    await mirror!.flush();
    expect(listed()).toEqual(['notes.txt']); // the manifest goes with the last file it owned
    expect(read('notes.txt')).toBe('the owner’s own file');
  });

  it('removes a deleted Space’s mirror, its artifacts now in no Space', async () => {
    await startMirror();
    const space = await linkedSpace();
    await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    expect(listed()).toHaveLength(2);
    await store().deleteSpace(space.id);
    await mirror!.flush();
    expect(listed()).toEqual([]);
  });

  it('leaves a foreign file at the target name alone, logged, and never removes it', async () => {
    await startMirror();
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: 'Page', content: html('mine') }, agent);
    mkdirSync(out(), { recursive: true });
    writeFileSync(out(`${mirrorSlug(page)}.html`), 'theirs');
    await store().update(page.id, { spaceId: space.id });
    await mirror!.flush();
    expect(read(`${mirrorSlug(page)}.html`)).toBe('theirs');
    expect(logs.some((line) => line.includes(`${mirrorSlug(page)}.html`) && /not the mirror's|not written/.test(line))).toBe(true);
    expect(existsSync(out(MIRROR_MANIFEST)) ? manifest().artifacts[page.id]?.files ?? [] : []).toEqual([]);

    await store().delete(page.id);
    await mirror!.flush();
    expect(read(`${mirrorSlug(page)}.html`)).toBe('theirs');
  });

  it('brings the directory up to date at a host start after changes made while it was down', async () => {
    await startMirror();
    const space = await linkedSpace();
    const kept = await store().create({ kind: 'html', title: 'Kept', spaceId: space.id, content: html('v1') }, agent);
    const renamed = await store().create({ kind: 'html', title: 'Old name', spaceId: space.id, content: html('r') }, agent);
    const removed = await store().create({ kind: 'html', title: 'Removed', spaceId: space.id, content: html('gone') }, agent);
    await mirror!.flush();
    mirror!.close();
    mirror = null;

    await store().writeContent(kept.id, html('v2'), agent);
    await store().update(renamed.id, { title: 'New name' });
    await store().delete(removed.id);
    const added = await store().create({ kind: 'html', title: 'Added', spaceId: space.id, content: html('new') }, agent);

    await startMirror();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(kept)}.html`, `${mirrorSlug({ id: renamed.id, title: 'New name' })}.html`, `${mirrorSlug(added)}.html`].sort());
    expect(read(`${mirrorSlug(kept)}.html`)).toBe('<p>v2</p>');
  });

  it('writes nothing for a kind with no writer, not even the directory', async () => {
    await startMirror();
    const space = await linkedSpace();
    const doc = await store().create({ kind: 'document', title: 'No writer', spaceId: space.id }, human);
    await store().testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'text' }], human);
    await mirror!.flush();
    expect(existsSync(out())).toBe(false);
  });

  it('writes a registered kind’s files, folders included, from the committed document, and removes the folder with them', async () => {
    offs.push(
      registerMirrorWriter('presentation', ({ artifact, doc }) => ({
        files: { [`${mirrorSlug(artifact)}/deck.json`]: JSON.stringify({ title: artifact.title }), [`${mirrorSlug(artifact)}/slides/1.txt`]: doc!.get('root').toString() },
      })),
    );
    await startMirror();
    const space = await linkedSpace();
    const deck = await store().create({ kind: 'presentation', title: 'Deck', spaceId: space.id }, human);
    await store().testWrite(deck.id, 'w1', [{ op: 'insertText', index: 0, text: 'slide one' }], agent);
    await mirror!.flush();
    const slug = mirrorSlug(deck);
    expect(read(slug, 'slides', '1.txt')).toBe('slide one');
    expect(JSON.parse(read(slug, 'deck.json'))).toEqual({ title: 'Deck' });
    expect(mode(slug, 'deck.json')).toBe(0o444);

    await store().delete(deck.id);
    await mirror!.flush();
    expect(listed()).toEqual([]);
  });

  it('refuses a writer’s path outside its directory or onto the manifest, logged', async () => {
    offs.push(registerMirrorWriter('document', () => ({ files: { '../escape.md': 'x', [MIRROR_MANIFEST]: '{}', 'a//b.md': 'x', 'ok.md': 'fine' } })));
    await startMirror();
    const space = await linkedSpace();
    const doc = await store().create({ kind: 'document', title: 'Doc', spaceId: space.id }, human);
    await mirror!.flush();
    expect(existsSync(join(project, 'escape.md'))).toBe(false);
    expect(listed()).toEqual([MIRROR_MANIFEST, 'ok.md']);
    expect(manifest().artifacts[doc.id].files).toEqual(['ok.md']);
    expect(logs.filter((line) => line.includes('not a path the mirror writes'))).toHaveLength(3);
  });

  it('copies a file artifact under its own name prefixed by the slug, and mirrors one too large to copy as nothing', async () => {
    await startMirror({ maxFileBytes: 16 });
    const space = await linkedSpace();
    const small = join(userData, 'data.csv');
    writeFileSync(small, 'a,b\n1,2\n');
    const big = join(userData, 'big.bin');
    writeFileSync(big, new Uint8Array(17));
    const data = await store().create({ kind: 'file', title: 'Data', spaceId: space.id, content: { path: small } }, agent);
    const large = await store().create({ kind: 'file', title: 'Big', spaceId: space.id, content: { path: big } }, agent);
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(data)}-data.csv`]);
    expect(read(`${mirrorSlug(data)}-data.csv`)).toBe('a,b\n1,2\n');
    expect(logs.some((line) => line.includes(large.id) && line.includes('too large'))).toBe(true);
  });

  it('logs a failing directory per Space and retries it at the next change', async () => {
    await startMirror();
    const missing = join(project, 'later');
    const space = await linkedSpace('Elsewhere', missing);
    const page = await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    expect(logs.some((line) => line.includes('Elsewhere') && line.includes(missing))).toBe(true);
    expect(existsSync(missing)).toBe(false); // the linked directory itself is never created

    mkdirSync(missing);
    await store().update(page.id, { title: 'Page 2' });
    await mirror!.flush();
    expect(readdirSync(join(missing, 'artifacts')).sort()).toEqual([MIRROR_MANIFEST, `${mirrorSlug({ id: page.id, title: 'Page 2' })}.html`]);
  });

  it('keeps two Spaces linked to one directory in one manifest', async () => {
    await startMirror();
    const one = await linkedSpace('One');
    const two = await linkedSpace('Two');
    const a = await store().create({ kind: 'html', title: 'A', spaceId: one.id, content: html('a') }, agent);
    const b = await store().create({ kind: 'html', title: 'B', spaceId: two.id, content: html('b') }, agent);
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(a)}.html`, `${mirrorSlug(b)}.html`].sort());
    await store().updateSpace(one.id, { linkedDir: null });
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(b)}.html`]);
  });

  it('leaves a foreign dangling link at the target name alone and unowned', async () => {
    await startMirror();
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: 'Page', content: html('mine') }, agent);
    mkdirSync(out(), { recursive: true });
    const name = `${mirrorSlug(page)}.html`;
    symlinkSync(join(project, 'nowhere.html'), out(name));
    await store().update(page.id, { spaceId: space.id });
    await mirror!.flush();
    expect(lstatSync(out(name)).isSymbolicLink()).toBe(true);
    expect(readlinkSync(out(name))).toBe(join(project, 'nowhere.html'));
    expect(existsSync(out(MIRROR_MANIFEST)) ? manifest().artifacts[page.id]?.files ?? [] : []).toEqual([]);
    expect(logs.some((line) => line.includes(name) && line.includes('not written'))).toBe(true);
  });

  it('owns what it wrote when removing a stale file fails, and removes it at the next change', async () => {
    // version 1 writes keep/one.txt and locked/two.txt; version 2 drops two.txt and adds keep/three.txt
    offs.push(
      registerMirrorWriter('document', ({ doc }): MirrorOutput =>
        doc!.get('root').toString().includes('v2')
          ? { files: { 'keep/one.txt': doc!.get('root').toString(), 'keep/three.txt': 'three' } }
          : { files: { 'keep/one.txt': doc!.get('root').toString(), 'locked/two.txt': 'two' } },
      ),
    );
    await startMirror();
    const space = await linkedSpace();
    const doc = await store().create({ kind: 'document', title: 'Doc', spaceId: space.id }, human);
    await store().testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'v1' }], human);
    await mirror!.flush();
    expect(manifest().artifacts[doc.id].files).toEqual(['keep/one.txt', 'locked/two.txt']);

    chmodSync(out('locked'), 0o555); // its files cannot be removed
    try {
      await store().testWrite(doc.id, 'w2', [{ op: 'insertText', index: 0, text: 'v2 ' }], human);
      await new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50)); // the store's feed holds a second commit this long
      await mirror!.flush();
      expect(read('keep', 'three.txt')).toBe('three');
      expect(manifest().artifacts[doc.id].files).toEqual(['keep/one.txt', 'keep/three.txt', 'locked/two.txt']); // the new file owned, the stale one kept
    } finally {
      chmodSync(out('locked'), 0o755);
    }
    await store().update(doc.id, { pinned: true }); // a later change: retried even though the revision did not move
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, 'keep', 'keep/one.txt', 'keep/three.txt']);
    expect(manifest().artifacts[doc.id].files).toEqual(['keep/one.txt', 'keep/three.txt']);
  });

  it('remembers an unlinked directory whose cleanup failed and cleans it at a later change', async () => {
    await startMirror();
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    chmodSync(out(), 0o555);
    try {
      await store().updateSpace(space.id, { linkedDir: null });
      await mirror!.flush();
      expect(listed()).toContain(`${mirrorSlug(page)}.html`);
    } finally {
      chmodSync(out(), 0o755);
    }
    await store().create({ kind: 'html', title: 'Elsewhere', content: html('y') }, agent); // any later change
    await mirror!.flush();
    expect(listed()).toEqual([]);
  });

  it('remembers an unlinked directory that was away when it was unlinked, and cleans it once it is back', async () => {
    await startMirror();
    const space = await linkedSpace();
    await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    const away = `${project}-away`;
    renameSync(project, away); // the linked directory's load fails while it is away
    await store().create({ kind: 'html', title: 'Second', spaceId: space.id, content: html('y') }, agent);
    await mirror!.flush();
    await store().updateSpace(space.id, { linkedDir: null });
    await mirror!.flush();
    renameSync(away, project);
    expect(listed()).toHaveLength(2); // the first page and the manifest
    await store().create({ kind: 'html', title: 'Elsewhere', content: html('z') }, agent); // any later change
    await mirror!.flush();
    expect(listed()).toEqual([]);
  });

  it('keeps a file it cannot inspect owned and pending until it can, never dropping it as removed', async () => {
    offs.push(
      registerMirrorWriter('document', ({ doc }): MirrorOutput =>
        doc!.get('root').toString().includes('v2') ? { files: { 'keep/one.txt': 'one' } } : { files: { 'keep/one.txt': 'one', 'locked/sub/file.txt': 'file' } },
      ),
    );
    await startMirror();
    const space = await linkedSpace();
    const doc = await store().create({ kind: 'document', title: 'Doc', spaceId: space.id }, human);
    await store().testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'v1' }], human);
    await mirror!.flush();
    expect(manifest().artifacts[doc.id].files).toEqual(['keep/one.txt', 'locked/sub/file.txt']);

    chmodSync(out('locked'), 0o644); // no search permission: what is below it cannot be inspected
    try {
      await store().testWrite(doc.id, 'w2', [{ op: 'insertText', index: 0, text: 'v2 ' }], human);
      await new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50));
      await mirror!.flush();
      expect(manifest().artifacts[doc.id].files).toEqual(['keep/one.txt', 'locked/sub/file.txt']);
    } finally {
      chmodSync(out('locked'), 0o755);
    }
    expect(read('locked', 'sub', 'file.txt')).toBe('file');
    await store().update(doc.id, { pinned: true }); // a later change, once it can be inspected again
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, 'keep', 'keep/one.txt']);
    expect(manifest().artifacts[doc.id].files).toEqual(['keep/one.txt']);
  });

  it('cleans a directory unlinked while it was away from a mirror started without it, once it is back', async () => {
    await startMirror();
    const space = await linkedSpace();
    await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    mirror!.close();
    const away = `${project}-away`;
    renameSync(project, away);
    await startMirror(); // its first load of the directory fails
    await store().updateSpace(space.id, { linkedDir: null });
    await mirror!.flush();
    renameSync(away, project);
    expect(listed()).toHaveLength(2);
    await store().create({ kind: 'html', title: 'Elsewhere', content: html('z') }, agent); // any later change
    await mirror!.flush();
    expect(listed()).toEqual([]);
  });

  it('never trusts a manifest’s path out of its directory, and never follows a link inside it', async () => {
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
    const outside = join(project, 'precious.txt');
    writeFileSync(outside, 'keep');
    const elsewhere = mkdtempSync(join(tmpdir(), 'maws-mirror-elsewhere-'));
    writeFileSync(join(elsewhere, 'secret.txt'), 'keep');
    mkdirSync(out(), { recursive: true });
    symlinkSync(elsewhere, out('linked'));
    writeFileSync(out(MIRROR_MANIFEST), JSON.stringify({ version: 1, artifacts: { [page.id]: { revision: 0, slug: 'x', files: ['../precious.txt', 'linked/secret.txt', '/etc/hosts'] } } }));
    await startMirror();
    await store().delete(page.id);
    await mirror!.flush();
    expect(readFileSync(outside, 'utf8')).toBe('keep');
    expect(readFileSync(join(elsewhere, 'secret.txt'), 'utf8')).toBe('keep');
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('refuses an `artifacts` that is a link, and never recreates a linked directory the owner removed', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'maws-mirror-elsewhere-'));
    symlinkSync(elsewhere, out());
    await startMirror();
    const space = await linkedSpace();
    await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(logs.some((line) => line.includes('Launch') && line.includes('not a directory of its own'))).toBe(true);
    rmSync(out());
    rmSync(elsewhere, { recursive: true, force: true });

    const page = await store().create({ kind: 'html', title: 'Second', spaceId: space.id, content: html('y') }, agent);
    await mirror!.flush();
    expect(listed()).toHaveLength(3);
    rmSync(project, { recursive: true, force: true }); // the owner removes the linked directory
    await store().update(page.id, { title: 'Third' });
    await mirror!.flush();
    expect(existsSync(project)).toBe(false);
  });
});

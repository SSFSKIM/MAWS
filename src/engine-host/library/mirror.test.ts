// The linked-directory mirror over a real store (the P3-L document, M2; Decision Log 12): a linked Space's artifacts
// written read-only under `<linkedDir>/artifacts/` after each change settles, the manifest owning exactly what the
// mirror wrote, and a host start bringing the directory up to date.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentMirrorWriter } from '@artifacts/document/mirror'; // P3-F (F11)
import { schemaFor } from '@artifacts/document/schema'; // P3-F (F11)
import { addTab, createDocument, deleteTab } from '@artifacts/document/tabs'; // P3-F (F11)
import { mirrorSlug, registerMirrorWriter, type MirrorInput, type MirrorOutput, type MirrorWriter } from '@artifacts/library/mirror';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { openDocuments, type Documents } from '../documents';
import { CHANGE_COALESCE_MS } from '../documents/store';
import { cloneFile, LibraryMirror, MIRROR_MANIFEST, type MirrorOptions } from './mirror';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' as AppSessionId };

let userData: string;
let project: string;
let documents: Documents;
let mirror: LibraryMirror | null;
let logs: string[];
const offs: (() => void)[] = [];

function startMirror(options: Omit<MirrorOptions, 'log'> = {}): Promise<void> {
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

  it('refuses a directory whose manifest path holds something not a MAWS manifest, never touching it, and mirrors there once it is gone (whole-branch review)', async () => {
    for (const theirs of ['the owner’s notes, not JSON', `${JSON.stringify({ version: 2, owner: 'another tool' })}\n`]) {
      mkdirSync(out(), { recursive: true });
      writeFileSync(out(MIRROR_MANIFEST), theirs);
      await startMirror();
      const space = await linkedSpace();
      const page = await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
      await mirror!.flush();
      expect(listed()).toEqual([MIRROR_MANIFEST]); // nothing mirrored there
      expect(read(MIRROR_MANIFEST)).toBe(theirs);
      expect(logs.some((line) => line.includes('Launch') && line.includes(MIRROR_MANIFEST))).toBe(true);

      await store().update(page.id, { spaceId: null }); // the directory's desired set now empty: the manifest still stays
      await store().updateSpace(space.id, { linkedDir: null });
      await mirror!.flush();
      expect(read(MIRROR_MANIFEST)).toBe(theirs);

      rmSync(out(MIRROR_MANIFEST)); // the owner moves their file away: the next change mirrors
      await store().updateSpace(space.id, { linkedDir: project });
      await store().update(page.id, { spaceId: space.id });
      await mirror!.flush();
      expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(page)}.html`]);
      expect(manifest().artifacts[page.id].files).toEqual([`${mirrorSlug(page)}.html`]);

      mirror!.close();
      mirror = null;
      await store().delete(page.id);
      await store().deleteSpace(space.id);
      rmSync(out(), { recursive: true, force: true });
      logs.length = 0;
    }
  });

  it('keeps the mirror of an artifact renamed by case only, on this machine’s filesystem (whole-branch review)', async () => {
    await startMirror();
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: 'Report', spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(page)}.html`]);

    await store().update(page.id, { title: 'report' });
    await mirror!.flush();
    const renamed = `${mirrorSlug({ id: page.id, title: 'report' })}.html`;
    expect(listed()).toEqual([MIRROR_MANIFEST, renamed]);
    expect(read(renamed)).toBe('<p>x</p>');
    expect(manifest().artifacts[page.id].files).toEqual([renamed]);
    expect(logs).toEqual([]);

    await store().delete(page.id); // still owned: removed with the artifact
    await mirror!.flush();
    expect(listed()).toEqual([]);
  });

  // P4 (tracker L136): the volume says which names are one entry, not a fold of the mirror's own. On APFS (this Mac's
  // tmpdir) each pair is one entry that lowercasing after NFC tells apart; on a case-sensitive volume each is two names.
  it.each([
    ['Straße', 'STRASSE'],
    ['οδος', 'οδοσ'], // a final sigma
    ['ﬁle', 'file'], // a ligature
  ])('keeps the mirror of an artifact renamed from %s to %s, one name or two on this machine’s filesystem (tracker L136)', async (before, after) => {
    await startMirror();
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: before, spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(page)}.html`]);

    await store().update(page.id, { title: after });
    await mirror!.flush();
    const renamed = `${mirrorSlug({ id: page.id, title: after })}.html`;
    expect(listed()).toEqual([MIRROR_MANIFEST, renamed]);
    expect(read(renamed)).toBe('<p>x</p>');
    expect(manifest().artifacts[page.id].files).toEqual([renamed]);
    expect(logs).toEqual([]);
  });

  it('refuses a directory whose manifest path is a link, dangling or not, leaving the link and what it points at alone (fix wave 2)', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'maws-mirror-elsewhere-'));
    try {
      writeFileSync(join(elsewhere, 'kept.json'), 'the owner’s file');
      for (const target of [join(elsewhere, 'not-mounted.json'), join(elsewhere, 'kept.json')]) {
        mkdirSync(out(), { recursive: true });
        symlinkSync(target, out(MIRROR_MANIFEST));
        await startMirror();
        const space = await linkedSpace();
        const page = await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
        await mirror!.flush();
        expect(listed()).toEqual([MIRROR_MANIFEST]); // nothing mirrored there
        expect(readlinkSync(out(MIRROR_MANIFEST))).toBe(target);
        expect(existsSync(join(elsewhere, 'not-mounted.json'))).toBe(false);
        expect(readFileSync(join(elsewhere, 'kept.json'), 'utf8')).toBe('the owner’s file');
        expect(logs.some((line) => line.includes('Launch') && line.includes(MIRROR_MANIFEST))).toBe(true);

        mirror!.close();
        mirror = null;
        await store().delete(page.id);
        await store().deleteSpace(space.id);
        rmSync(out(), { recursive: true, force: true });
        logs.length = 0;
      }
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('leaves an owner’s hard link of a mirrored file alone when the artifact is renamed to its name (fix wave 2)', async () => {
    await startMirror();
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: 'Original', spaceId: space.id, content: html('original') }, agent);
    await mirror!.flush();
    const backup = `${mirrorSlug({ id: page.id, title: 'Backup' })}.html`;
    linkSync(out(`${mirrorSlug(page)}.html`), out(backup)); // the owner's own copy under the name a rename will want

    await store().update(page.id, { title: 'Backup' });
    await store().writeContent(page.id, html('new'), agent);
    await mirror!.flush();
    expect(read(backup)).toBe('<p>original</p>');
    expect(logs.some((line) => line.includes(backup) && line.includes("not the mirror's"))).toBe(true);
    expect(existsSync(out(MIRROR_MANIFEST)) ? manifest().artifacts[page.id]?.files ?? [] : []).toEqual([]);

    await store().delete(page.id);
    await mirror!.flush();
    expect(read(backup)).toBe('<p>original</p>');
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

  // M6b (Decision Log 35, 37b): a writer is handed the artifact's assets as the store lists them (`artifacts.assets`'s
  // listing) and reads the bytes of the ones it needs, lazily: a design system's fonts land in its linked directory
  it('hands a writer the artifact’s assets and reads only the ones it asks for', async () => {
    const asked: string[] = [];
    const seen: unknown[] = [];
    offs.push(
      registerMirrorWriter('design_system', ({ artifact, assets, readAsset }) => {
        seen.push(assets);
        const face = assets?.find((asset) => asset.name === 'face.woff2');
        if (!face) return { files: {} };
        asked.push(face.ref);
        return { files: { [`${mirrorSlug(artifact)}/fonts/${face.name}`]: readAsset!(face.ref) } };
      }),
    );
    await startMirror();
    const reads: string[] = [];
    const readAsset = store().files.readAsset.bind(store().files);
    store().files.readAsset = (artifactId, sha256) => (reads.push(sha256), readAsset(artifactId, sha256));
    const space = await linkedSpace();
    const system = await store().create({ kind: 'design_system', title: 'House style', spaceId: space.id }, human);
    await store().uploadAsset(system.id, new Uint8Array([1, 2, 3, 4]), { name: 'face.woff2', mime: 'font/woff2' }, human);
    await store().uploadAsset(system.id, new Uint8Array([9, 9]), { name: 'logo.png', mime: 'image/png' }, human);
    await mirror!.flush();
    await until(() => existsSync(out(mirrorSlug(system), 'fonts', 'face.woff2')));
    expect([...readFileSync(out(mirrorSlug(system), 'fonts', 'face.woff2'))]).toEqual([1, 2, 3, 4]);
    expect(seen.at(-1)).toEqual([
      { ref: 'assets/face.woff2', name: 'face.woff2', mime: 'font/woff2', size: 4 },
      { ref: 'assets/logo.png', name: 'logo.png', mime: 'image/png', size: 2 },
    ]);
    expect(new Set(asked)).toEqual(new Set(['assets/face.woff2']));
    const logo = store().listAssets(system.id).find((asset) => asset.name === 'logo.png')!;
    expect(reads.length).toBeGreaterThan(0);
    expect(reads).not.toContain(logo.sha256); // the logo's bytes were never read
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

  // P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, the final review's A14; Decision Log 37 (1)): a copy
  // (a file whose bytes never change under its name, as a content-addressed asset's) is read and written only when the
  // mirror lacks it, and dropped like any file once the writer no longer names it
  it('writes a copy only where the mirror lacks it, reading its bytes only then', async () => {
    let reads = 0;
    const copy = { read: () => (reads++, new Uint8Array([5, 6])) };
    offs.push(registerMirrorWriter('document', ({ doc }): MirrorOutput => ({ files: { 'd/text.txt': doc!.get('root').toString(), ...(doc!.get('root').toString().includes('drop') ? {} : { 'd/assets/a.bin': copy }) } })));
    await startMirror();
    const space = await linkedSpace();
    const doc = await store().create({ kind: 'document', title: 'Doc', spaceId: space.id }, human);
    await store().testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'v1' }], human);
    await mirror!.flush();
    expect([...readFileSync(out('d', 'assets', 'a.bin'))]).toEqual([5, 6]);
    expect(mode('d', 'assets', 'a.bin')).toBe(0o444);
    const before = reads;
    expect(before).toBeGreaterThan(0);

    await store().testWrite(doc.id, 'w2', [{ op: 'insertText', index: 0, text: 'v2 ' }], human);
    await new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50));
    await mirror!.flush();
    expect(read('d', 'text.txt')).toContain('v2');
    expect(reads).toBe(before); // in place: kept, not read
    expect(manifest().artifacts[doc.id].files).toEqual(['d/assets/a.bin', 'd/text.txt']);

    rmSync(out('d', 'assets', 'a.bin'));
    await store().testWrite(doc.id, 'w3', [{ op: 'insertText', index: 0, text: 'v3 ' }], human);
    await new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50));
    await mirror!.flush();
    expect(reads).toBe(before + 1); // gone from the mirror: read and written again
    expect([...readFileSync(out('d', 'assets', 'a.bin'))]).toEqual([5, 6]);

    await store().testWrite(doc.id, 'w4', [{ op: 'insertText', index: 0, text: 'drop ' }], human);
    await new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50));
    await mirror!.flush();
    expect(existsSync(out('d', 'assets', 'a.bin'))).toBe(false);
    expect(manifest().artifacts[doc.id].files).toEqual(['d/text.txt']);
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

// P3-C start (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md Decision Log 29; the P3 spec's Decision Log 69): a
// writer's `inputs`, what its output depends on beyond the artifact's revision (a deck's: its governing design system and
// that system's revision), kept in the manifest entry and compared beside the revision; `refresh`, scheduling artifacts
// as their own change does, for a change elsewhere that `inputs` may tell. L's cases above run unmodified.
describe('a writer’s inputs and the mirror’s refresh (P3-C)', () => {
  /** A deck writer whose output names `state.inputs`; it declares `inputs` unless `declares` is false. */
  function registerDeckWriter(state: { inputs: string }, declares = true): { calls: string[] } {
    const calls: string[] = [];
    const write = ({ artifact }: MirrorInput): MirrorOutput => {
      calls.push(artifact.title);
      return { files: { [`${mirrorSlug(artifact)}/deck.json`]: JSON.stringify({ inputs: state.inputs }) } };
    };
    const writer: MirrorWriter = declares ? Object.assign(write, { inputs: () => state.inputs }) : write;
    offs.push(registerMirrorWriter('presentation', writer));
    return { calls };
  }
  const entryOf = (artifactId: string) => (JSON.parse(read(MIRROR_MANIFEST)) as { artifacts: Record<string, Record<string, unknown>> }).artifacts[artifactId];
  async function mirroredDeck(title = 'Deck') {
    const space = await linkedSpace();
    const deck = await store().create({ kind: 'presentation', title, spaceId: space.id }, human);
    await store().testWrite(deck.id, 'w1', [{ op: 'insertText', index: 0, text: 'slide one' }], agent);
    await mirror!.flush();
    await until(() => existsSync(out(mirrorSlug(deck), 'deck.json')));
    return deck;
  }

  it('rewrites an artifact refreshed when only its inputs changed, keeps them in its entry, and not when neither changed', async () => {
    const state = { inputs: 'system@1' };
    const { calls } = registerDeckWriter(state);
    await startMirror();
    const deck = await mirroredDeck();
    const written = calls.length;
    expect(entryOf(deck.id)).toMatchObject({ revision: store().revision(deck.id), inputs: 'system@1' });

    mirror!.refresh([deck.id]); // nothing changed: current
    await mirror!.flush();
    expect(calls).toHaveLength(written);

    state.inputs = 'system@2'; // the system the deck draws in changed; the deck did not
    mirror!.refresh([deck.id]);
    await mirror!.flush();
    expect(calls).toHaveLength(written + 1);
    expect(JSON.parse(read(mirrorSlug(deck), 'deck.json'))).toEqual({ inputs: 'system@2' });
    expect(entryOf(deck.id)).toMatchObject({ inputs: 'system@2' });
  });

  it('rewrites once an entry written without inputs for a kind that now declares them', async () => {
    const state = { inputs: 'system@1' };
    registerDeckWriter(state, false);
    await startMirror();
    const deck = await mirroredDeck();
    expect(entryOf(deck.id)).not.toHaveProperty('inputs');

    const { calls } = registerDeckWriter(state); // a later build's writer, declaring them
    mirror!.refresh([deck.id]);
    await mirror!.flush();
    expect(calls).toEqual(['Deck']);
    expect(entryOf(deck.id)).toMatchObject({ inputs: 'system@1' });
    mirror!.refresh([deck.id]);
    await mirror!.flush();
    expect(calls).toEqual(['Deck']);
  });

  it('schedules a refresh as a change: written once it settles, and an id the store does not hold writes nothing', async () => {
    const state = { inputs: 'system@1' };
    const { calls } = registerDeckWriter(state);
    await startMirror({ settleMs: 40 });
    const deck = await mirroredDeck();
    const written = calls.length;
    state.inputs = 'system@2';
    mirror!.refresh([deck.id, '00000000-0000-4000-8000-00000000dead']);
    expect(calls).toHaveLength(written); // not yet: it waits for the settle, as a change does
    await until(() => calls.length === written + 1);
    expect(JSON.parse(read(mirrorSlug(deck), 'deck.json'))).toEqual({ inputs: 'system@2' });
    await mirror!.flush();
    expect(logs).toEqual([]);
  });

  it('keeps a kind without inputs as it was: a refresh rewrites nothing and its entry names no inputs', async () => {
    await startMirror();
    const space = await linkedSpace();
    const page = await store().create({ kind: 'html', title: 'Page', spaceId: space.id, content: html('x') }, agent);
    await mirror!.flush();
    await until(() => existsSync(out(`${mirrorSlug(page)}.html`)));
    const before = statSync(out(`${mirrorSlug(page)}.html`)).mtimeMs;
    mirror!.refresh([page.id]);
    await mirror!.flush();
    expect(statSync(out(`${mirrorSlug(page)}.html`)).mtimeMs).toBe(before);
    expect(Object.keys(entryOf(page.id)!).sort()).toEqual(['files', 'revision', 'slug']);
  });
});
// P3-C end

// P3-F (the library panel's F-library wave): a directory away or relinked keeps what the mirror owns there and is never
// written through; one directory spelled two ways is one directory; a link in a copy's place is not the copy.
describe('the mirror over a directory that goes away, is relinked or is spelled two ways (P3-F)', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const page = (title: string, spaceId: string) => store().create({ kind: 'html', title, spaceId, content: html(title) }, agent);
  const file = (artifact: { id: string; title: string }) => `${mirrorSlug(artifact)}.html`;

  it('keeps the entry of an artifact deleted while its directory is away, and removes its file once the directory is back (library sweep#1)', async () => {
    await startMirror();
    const space = await linkedSpace();
    const gone = await page('Gone', space.id);
    const kept = await page('Kept', space.id);
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, file(gone), file(kept)].sort());
    const away = `${project}-away`;

    renameSync(project, away);
    try {
      await store().delete(gone.id);
      await mirror!.flush();
    } finally {
      renameSync(away, project);
    }
    await store().writeContent(kept.id, html('Kept 2'), agent); // a later change in the Space
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, file(kept)]);
    expect(Object.keys(manifest().artifacts)).toEqual([kept.id]);

    renameSync(project, away); // the last entry too
    try {
      await store().delete(kept.id);
      await mirror!.flush();
    } finally {
      renameSync(away, project);
    }
    await store().updateSpace(space.id, { name: 'Launch 2' }); // a later change of the Space
    await mirror!.flush();
    expect(listed()).toEqual([]);
  });

  it('never writes the manifest through an `artifacts` relinked while the host runs, keeping another project’s manifest there as it was (library scalpel-2#1)', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'maws-mirror-elsewhere-'));
    try {
      await startMirror();
      const space = await linkedSpace();
      const a = await page('A', space.id);
      await page('B', space.id);
      await mirror!.flush();
      const theirs = `${JSON.stringify({ version: 1, artifacts: { other: { revision: 3, slug: 'other', files: ['other.html'] } } }, null, 2)}\n`;
      writeFileSync(join(elsewhere, MIRROR_MANIFEST), theirs); // another project's mirror
      renameSync(out(), join(project, 'artifacts-moved'));
      symlinkSync(elsewhere, out()); // the owner relinks `artifacts/`

      await store().delete(a.id);
      await mirror!.flush();
      expect(readdirSync(elsewhere)).toEqual([MIRROR_MANIFEST]);
      expect(readFileSync(join(elsewhere, MIRROR_MANIFEST), 'utf8')).toBe(theirs);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('never writes the manifest through an `artifacts` relinked during a pass (library scalpel-2#1)', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'maws-mirror-elsewhere-'));
    try {
      let relink = false;
      offs.push(
        registerMirrorWriter('document', ({ artifact, doc }) => {
          if (relink) {
            relink = false;
            renameSync(out(), join(project, 'artifacts-moved'));
            symlinkSync(elsewhere, out()); // the owner relinks `artifacts/` while the mirror writes
          }
          return { files: { [`${mirrorSlug(artifact)}.md`]: doc!.get('root').toString() } };
        }),
      );
      await startMirror();
      const space = await linkedSpace();
      await page('Page', space.id); // the manifest keeps naming this one
      const doc = await store().create({ kind: 'document', title: 'Doc', spaceId: space.id }, human);
      await store().testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'v1' }], human);
      await mirror!.flush();
      expect(listed()).toHaveLength(3);

      relink = true;
      await store().testWrite(doc.id, 'w2', [{ op: 'insertText', index: 0, text: 'v2 ' }], human);
      await sleep(CHANGE_COALESCE_MS + 50);
      await mirror!.flush();
      expect(relink).toBe(false);
      expect(readdirSync(elsewhere)).toEqual([]);
      expect(logs.some((line) => line.includes('could not be written'))).toBe(true);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('keeps two Spaces linked to one directory by two spellings in one manifest (library scalpel-2#2)', async () => {
    const links = mkdtempSync(join(tmpdir(), 'maws-mirror-links-'));
    try {
      const alias = join(links, 'alias');
      symlinkSync(project, alias); // the same directory, spelled through a link
      const one = await linkedSpace('One');
      const two = await linkedSpace('Two', alias);
      const a = await page('A', one.id);
      const b = await page('B', two.id);
      await startMirror();
      expect(listed()).toEqual([MIRROR_MANIFEST, file(a), file(b)].sort());
      expect(Object.keys(manifest().artifacts).sort()).toEqual([a.id, b.id].sort());

      await store().updateSpace(one.id, { name: 'One again' }); // a later reconciliation
      await mirror!.flush();
      expect(listed()).toEqual([MIRROR_MANIFEST, file(a), file(b)].sort());
      await store().updateSpace(two.id, { linkedDir: null });
      await mirror!.flush();
      expect(listed()).toEqual([MIRROR_MANIFEST, file(a)]);
      expect(logs).toEqual([]);
    } finally {
      rmSync(links, { recursive: true, force: true });
    }
  });

  it('knows a directory away since the start under its real path once it is back: what it missed is mirrored, nothing else rewritten (library scalpel-2#2)', async () => {
    const links = mkdtempSync(join(tmpdir(), 'maws-mirror-links-'));
    const away = `${project}-away`;
    try {
      const alias = join(links, 'alias');
      symlinkSync(project, alias);
      const space = await linkedSpace('Launch', alias);
      const still = await page('Still', space.id);
      const gone = await page('Gone', space.id);
      const kept = await page('Kept', space.id);
      await startMirror();
      expect(listed()).toEqual([MIRROR_MANIFEST, file(still), file(gone), file(kept)].sort());
      const inode = lstatSync(out(file(still))).ino;
      mirror!.close();

      renameSync(project, away);
      let added: { id: string; title: string } | undefined;
      try {
        await startMirror(); // its first load fails: known by the spelling it is linked by
        await store().delete(gone.id);
        added = await page('Added', space.id);
        await mirror!.flush();
      } finally {
        renameSync(away, project);
      }
      await store().writeContent(kept.id, html('Kept 2'), agent); // a later change in the Space
      await mirror!.flush();
      await store().updateSpace(space.id, { name: 'Launch 2' });
      await mirror!.flush();
      expect(listed()).toEqual([MIRROR_MANIFEST, file(still), file(kept), file(added!)].sort());
      expect(read(file(kept))).toBe('<p>Kept 2</p>');
      expect(lstatSync(out(file(still))).ino).toBe(inode); // never removed and written again
    } finally {
      rmSync(links, { recursive: true, force: true });
      rmSync(away, { recursive: true, force: true });
    }
  });

  it('writes a copy over a link the owner put in its place, leaving what the link points at alone (library scalpel-2#3)', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'maws-mirror-elsewhere-'));
    try {
      const copy = { read: () => new Uint8Array([5, 6]) };
      offs.push(registerMirrorWriter('document', ({ doc }): MirrorOutput => ({ files: { 'd/text.txt': doc!.get('root').toString(), 'd/assets/a.bin': copy } })));
      await startMirror();
      const space = await linkedSpace();
      const doc = await store().create({ kind: 'document', title: 'Doc', spaceId: space.id }, human);
      await store().testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'v1' }], human);
      await mirror!.flush();
      expect([...readFileSync(out('d', 'assets', 'a.bin'))]).toEqual([5, 6]);
      writeFileSync(join(elsewhere, 'theirs.bin'), 'the owner’s file');
      rmSync(out('d', 'assets', 'a.bin'));
      symlinkSync(join(elsewhere, 'theirs.bin'), out('d', 'assets', 'a.bin'));

      await store().testWrite(doc.id, 'w2', [{ op: 'insertText', index: 0, text: 'v2 ' }], human);
      await sleep(CHANGE_COALESCE_MS + 50);
      await mirror!.flush();
      expect(lstatSync(out('d', 'assets', 'a.bin')).isFile()).toBe(true);
      expect([...readFileSync(out('d', 'assets', 'a.bin'))]).toEqual([5, 6]);
      expect(mode('d', 'assets', 'a.bin')).toBe(0o444);
      expect(readFileSync(join(elsewhere, 'theirs.bin'), 'utf8')).toBe('the owner’s file');
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('stops writing into a directory the Space’s link no longer reaches, and mirrors where it points once that is there (library review keyOf)', async () => {
    const links = mkdtempSync(join(tmpdir(), 'maws-mirror-links-'));
    try {
      const link = join(links, 'project');
      symlinkSync(project, link); // the Space's path, a link to the project
      await startMirror();
      const space = await linkedSpace('Launch', link);
      const first = await page('First', space.id);
      await mirror!.flush();
      expect(listed()).toEqual([MIRROR_MANIFEST, file(first)]);

      const later = join(links, 'later');
      rmSync(link);
      symlinkSync(later, link); // retargeted to a directory not there yet; the project stays on disk
      const second = await page('Second', space.id);
      await mirror!.flush();
      expect(listed()).toEqual([]); // nothing written there, and its mirror removed as any directory no Space links
      expect(logs.some((line) => line.includes('Launch') && line.includes(link))).toBe(true);

      mkdirSync(later);
      await store().writeContent(second.id, html('Second 2'), agent);
      await mirror!.flush();
      expect(readdirSync(join(later, 'artifacts')).sort()).toEqual([MIRROR_MANIFEST, file(first), file(second)].sort());
    } finally {
      rmSync(links, { recursive: true, force: true });
    }
  });

  it('keeps every file either manifest named when two directories it knew become one (library review merge)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maws-mirror-links-'));
    try {
      const [a, b] = [join(root, 'a'), join(root, 'b')];
      mkdirSync(a);
      mkdirSync(b);
      const mirrored = (dir: string) => (existsSync(join(dir, 'artifacts')) ? readdirSync(join(dir, 'artifacts')).sort() : []);
      const one = await linkedSpace('One', a);
      const two = await linkedSpace('Two', b);
      const moved = await page('Old', one.id);
      await startMirror();
      expect(mirrored(a)).toEqual([MIRROR_MANIFEST, file(moved)].sort());

      renameSync(a, `${a}-away`); // away while the artifact moves to b under a new name: a's entry stays owned
      await store().update(moved.id, { spaceId: two.id, title: 'New' });
      await mirror!.flush();
      const renamed = file({ id: moved.id, title: 'New' });
      expect(mirrored(b)).toEqual([MIRROR_MANIFEST, renamed].sort());

      rmSync(b, { recursive: true, force: true }); // the owner puts a's folder in b's place, a link left at a's name
      renameSync(`${a}-away`, b);
      symlinkSync(b, a);
      await store().updateSpace(one.id, { name: 'One again' });
      await mirror!.flush();
      expect(mirrored(b)).toEqual([MIRROR_MANIFEST, renamed].sort()); // a's file under the old name removed, never left unowned
      expect(Object.keys((JSON.parse(readFileSync(join(b, 'artifacts', MIRROR_MANIFEST), 'utf8')) as { artifacts: object }).artifacts)).toEqual([moved.id]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // P4 (tracker L249): a removal refused under a link fails rather than counting as done, so the entry outlives a pass
  // under an `artifacts` relinked inside it, and once the owner puts the original back its files are the mirror's again
  it.each([
    ['keeps its name', 'Doc'],
    ['is renamed', 'Doc renamed'],
  ])('keeps owning an artifact’s files through a pass under an `artifacts` relinked during it, when the artifact %s, and writes them once the original is back (tracker L249)', async (_, title) => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'maws-mirror-elsewhere-'));
    try {
      let relink = false;
      offs.push(
        registerMirrorWriter('document', ({ artifact, doc }) => {
          if (relink) {
            relink = false;
            renameSync(out(), join(project, 'artifacts-moved'));
            symlinkSync(elsewhere, out()); // the owner relinks `artifacts/` while the mirror writes
          }
          return { files: { [`${mirrorSlug(artifact)}.md`]: doc!.get('root').toString() } };
        }),
      );
      await startMirror();
      const space = await linkedSpace();
      const doc = await store().create({ kind: 'document', title: 'Doc', spaceId: space.id }, human);
      await store().testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'v1' }], human);
      await mirror!.flush();
      expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(doc)}.md`]);

      relink = true;
      if (title !== doc.title) await store().update(doc.id, { title });
      await store().testWrite(doc.id, 'w2', [{ op: 'insertText', index: 0, text: 'v2 ' }], human);
      await sleep(CHANGE_COALESCE_MS + 50);
      await mirror!.flush();
      expect(relink).toBe(false);
      expect(readdirSync(elsewhere)).toEqual([]);

      rmSync(out()); // the owner puts the original back in place
      renameSync(join(project, 'artifacts-moved'), out());
      await store().testWrite(doc.id, 'w3', [{ op: 'insertText', index: 0, text: 'v3 ' }], human);
      await sleep(CHANGE_COALESCE_MS + 50);
      await mirror!.flush();
      const name = `${mirrorSlug({ id: doc.id, title })}.md`;
      expect(listed()).toEqual([MIRROR_MANIFEST, name]);
      expect(read(name)).toBe('v3 v2 v1');
      expect(manifest().artifacts[doc.id].files).toEqual([name]);
      expect(logs.filter((line) => line.includes("not the mirror's"))).toEqual([]);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('writes a mirrored file over a link the owner put in its place at a later step, though the artifact did not change, leaving what the link points at alone (tracker L249)', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'maws-mirror-elsewhere-'));
    try {
      await startMirror();
      const space = await linkedSpace();
      const mine = await page('Page', space.id);
      await mirror!.flush();
      writeFileSync(join(elsewhere, 'theirs.html'), 'the owner’s file');
      rmSync(out(file(mine)));
      symlinkSync(join(elsewhere, 'theirs.html'), out(file(mine)));

      await store().updateSpace(space.id, { name: 'Launch 2' }); // a later step; the artifact's revision has not moved
      await mirror!.flush();
      expect(lstatSync(out(file(mine))).isFile()).toBe(true);
      expect(read(file(mine))).toBe('<p>Page</p>');
      expect(mode(file(mine))).toBe(0o444);
      expect(readFileSync(join(elsewhere, 'theirs.html'), 'utf8')).toBe('the owner’s file');
      expect(logs).toEqual([]);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  // P4 (tracker L254): a Space whose path reaches another directory than at its previous step (its link restored, or
  // retargeted at a directory that is there) is reconciled at the next step anywhere, not only at one that loads it
  it.each([
    ['restored after a step away', true],
    ['retargeted at another directory', false],
  ])('mirrors every artifact of a Space whose link reaches a directory again (%s) at the next step of another Space (tracker L254)', async (_, restored) => {
    const root = mkdtempSync(join(tmpdir(), 'maws-mirror-links-'));
    try {
      const [a, c, link] = [join(root, 'a'), join(root, 'c'), join(root, 'link')];
      mkdirSync(a);
      mkdirSync(c);
      symlinkSync(a, link);
      const mirrored = (dir: string) => (existsSync(join(dir, 'artifacts')) ? readdirSync(join(dir, 'artifacts')).sort() : []);
      await startMirror();
      const linked = await linkedSpace('Linked', link);
      const other = await linkedSpace('Other');
      const [one, two] = [await page('One', linked.id), await page('Two', linked.id)];
      const theirs = await page('Theirs', other.id);
      await mirror!.flush();
      const all = [MIRROR_MANIFEST, file(one), file(two)].sort();
      expect(mirrored(a)).toEqual(all);

      rmSync(link);
      if (restored) {
        await store().writeContent(theirs.id, html('Theirs 2'), agent); // only the other Space's steps meanwhile
        await mirror!.flush();
        expect(mirrored(a)).toEqual([]); // the link no longer reaches it: cleaned as a directory no Space links
      }
      symlinkSync(restored ? a : c, link);
      await store().writeContent(theirs.id, html('Theirs 3'), agent);
      await mirror!.flush();
      expect(mirrored(restored ? a : c)).toEqual(all);
      if (!restored) expect(mirrored(a)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// P3-F (F10, tracker L142; the owner: "something in real use might have something bigger … production-level product for
// general use"): a File artifact within the in-memory cap is copied through memory as before; one over it is cloned into
// the mirror through the file system, and mirrored as nothing only when that clone fails. `cloneFile` stands in for the
// file system's clone where a test needs one on any volume, or a failing one.
describe('a File artifact over the in-memory cap (P3-F F10)', () => {
  const temps = () => listed().filter((file) => /(^|\/)\.mirror-[^/]*\.tmp$/.test(file));
  const fileArtifact = (title: string, path: string, spaceId: string) => store().create({ kind: 'file', title, spaceId, content: { path } }, agent);
  // whether this test directory's volume can clone (the default clone refuses another volume or a file system that cannot)
  const volumeClones = (): boolean => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-mirror-clone-probe-'));
    try {
      writeFileSync(join(dir, 'probe'), 'x');
      cloneFile(join(dir, 'probe'), join(dir, 'clone'));
      return readFileSync(join(dir, 'clone'), 'utf8') === 'x';
    } catch {
      return false;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('copies one within the cap through memory, never cloning it, and clones one over it whole, read-only', async () => {
    const cloned: string[] = [];
    await startMirror({ maxFileBytes: 16, cloneFile: (from, to) => (cloned.push(from), copyFileSync(from, to)) });
    const space = await linkedSpace();
    const small = join(userData, 'data.csv');
    writeFileSync(small, 'a,b\n1,2\n');
    const big = join(userData, 'big.bin');
    writeFileSync(big, new Uint8Array(17).fill(7));
    const data = await fileArtifact('Data', small, space.id);
    const large = await fileArtifact('Big', big, space.id);
    await mirror!.flush();
    const bigName = `${mirrorSlug(large)}-big.bin`;
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(data)}-data.csv`, bigName].sort());
    expect(read(`${mirrorSlug(data)}-data.csv`)).toBe('a,b\n1,2\n');
    expect([...readFileSync(out(bigName))]).toEqual(Array(17).fill(7));
    expect(mode(bigName)).toBe(0o444);
    expect(cloned).toEqual([big]); // the cap only chooses the path: the small file never spawns a clone
    expect(logs.filter((line) => line.includes('mirrored as nothing'))).toEqual([]);
  });

  it('clones a 65 MiB file whole and byte-identical through the file system (skipped where the test volume cannot clone)', async (ctx) => {
    if (!volumeClones()) ctx.skip('this volume cannot clone (not APFS on macOS, no reflink elsewhere): the clone is refused here, and the failure tests below cover that path');
    await startMirror(); // the default cap and the default clone
    const space = await linkedSpace();
    const path = join(userData, 'take.mov');
    const bytes = Buffer.alloc(65 * 1024 * 1024);
    for (let at = 0; at < bytes.length; at += 4096) bytes[at] = (at >> 12) & 0xff;
    writeFileSync(path, bytes);
    const take = await fileArtifact('Take', path, space.id);
    await mirror!.flush();
    const name = `${mirrorSlug(take)}-take.mov`;
    expect(listed()).toEqual([MIRROR_MANIFEST, name]);
    expect(readFileSync(out(name)).equals(bytes)).toBe(true);
    expect(mode(name)).toBe(0o444);
    expect(logs).toEqual([]);
  });

  // each way the clone can fail (refused by its guard, cp not spawned, cp past its timeout), the temp it left removed
  const failures: [string, () => Error][] = [
    ['refused', () => Object.assign(new Error('the clone was refused: another volume'), { code: 'EXDEV' })],
    ['not spawned', () => Object.assign(new Error('spawnSync /bin/cp ENOENT'), { code: 'ENOENT', syscall: 'spawnSync /bin/cp' })],
    ['timed out', () => Object.assign(new Error('spawnSync /bin/cp ETIMEDOUT'), { code: 'ETIMEDOUT' })],
  ];
  it.each(failures)('mirrors one over the cap as nothing when its clone fails (%s): no temp, no folder made, and its earlier copy removed', async (_, failure) => {
    let failing = true;
    await startMirror({
      maxFileBytes: 16,
      cloneFile: (from, to) => {
        if (!failing) return copyFileSync(from, to);
        writeFileSync(to, 'part of it'); // a clone killed half-way leaves a partial temp
        throw failure();
      },
    });
    const space = await linkedSpace();
    const big = join(userData, 'big.bin');
    writeFileSync(big, new Uint8Array(17));
    const large = await fileArtifact('Big', big, space.id);
    await mirror!.flush();
    expect(existsSync(out())).toBe(false); // nothing written, not even `artifacts/`
    expect(logs.some((line) => line.includes(large.id) && line.includes(failure().message) && line.includes('mirrored as nothing'))).toBe(true);

    failing = false;
    writeFileSync(big, new Uint8Array(18));
    await store().writeContent(large.id, { path: big }, agent);
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${mirrorSlug(large)}-big.bin`]);

    failing = true;
    writeFileSync(big, new Uint8Array(19));
    await store().writeContent(large.id, { path: big }, agent);
    await mirror!.flush();
    expect(listed()).toEqual([]); // the stale copy removed (the leftover rule) with the manifest that named only it, no temp left
  });

  it('leaves no temp and the entry at revision -1 when the write after a clone fails, as any failed write', async () => {
    await startMirror({ maxFileBytes: 16, cloneFile: (from, to) => copyFileSync(from, to) });
    const space = await linkedSpace();
    const big = join(userData, 'big.bin');
    writeFileSync(big, new Uint8Array(17));
    const large = await fileArtifact('Big', big, space.id);
    await mirror!.flush();
    const name = `${mirrorSlug(large)}-big.bin`;
    rmSync(out(name));
    mkdirSync(out(name)); // a folder of the owner's in its place: the rename over it fails
    writeFileSync(out(name, 'owner.txt'), 'kept');

    writeFileSync(big, new Uint8Array(18));
    await store().writeContent(large.id, { path: big }, agent);
    await mirror!.flush();
    const entry = (JSON.parse(read(MIRROR_MANIFEST)) as { artifacts: Record<string, { revision: number; files: string[] }> }).artifacts[large.id];
    expect(entry).toMatchObject({ revision: -1, files: [name] });
    expect(temps()).toEqual([]);
    expect(read(name, 'owner.txt')).toBe('kept');
    expect(logs.some((line) => line.includes(large.id) && line.includes('could not be mirrored'))).toBe(true);
  });

  // F10's review (P1): clonefile copies the source's BSD flags, and a File artifact's file is the owner's own, so one locked
  // in Finder (`uchg`) cloned as a temp that neither chmod nor rm could touch, one more left in the owner's folder each pass.
  // Its recheck: a path is stored as given, and a link to a locked file read as flagless (stat without -L reads the link).
  it.for([
    ['named directly', false],
    ['named through a symlink', true],
  ] as const)('mirrors a locked file over the cap (%s) as nothing, refused before a clone that would copy the lock, no temp left (macOS)', async ([, viaLink], ctx) => {
    if (process.platform !== 'darwin') ctx.skip('BSD file flags (a Finder lock is `uchg`) and chflags are macOS’s');
    if (!volumeClones()) ctx.skip('this volume cannot clone: the guard refuses it before reading any flag');
    await startMirror({ maxFileBytes: 16 }); // the default clone
    const space = await linkedSpace();
    const locked = join(userData, 'locked.bin');
    writeFileSync(locked, new Uint8Array(17));
    execFileSync('/usr/bin/chflags', ['uchg', locked]);
    try {
      const path = viaLink ? join(userData, 'link.bin') : locked;
      if (viaLink) symlinkSync(locked, path);
      const large = await fileArtifact('Locked', path, space.id);
      await mirror!.flush();
      expect(existsSync(out())).toBe(false); // no temp, no folder
      expect(logs.some((line) => line.includes(large.id) && line.includes('flags') && line.includes('mirrored as nothing'))).toBe(true);
    } finally {
      execFileSync('/usr/bin/chflags', ['-R', 'nouchg', userData, project]); // else a lock copied to a temp outlives the test
    }
  });

  it('logs a temp it cannot remove beside the clone’s own failure, neither masking the other', async () => {
    await startMirror({
      maxFileBytes: 16,
      cloneFile: (_, to) => {
        mkdirSync(to); // a temp that rm cannot remove: a folder with something in it
        writeFileSync(join(to, 'part'), 'x');
        throw new Error('the clone stalled');
      },
    });
    const space = await linkedSpace();
    const big = join(userData, 'big.bin');
    writeFileSync(big, new Uint8Array(17));
    const large = await fileArtifact('Big', big, space.id);
    await mirror!.flush();
    expect(logs.some((line) => line.includes(large.id) && line.includes('the clone stalled') && line.includes('could not be removed') && line.includes('mirrored as nothing'))).toBe(true);
  });

  // F10's review (P3): the real clone's own refusals, which keep `cp -c` from its silent byte copy
  it('the real clone refuses a source that is not a regular file, making nothing', () => {
    const to = join(project, 'clone');
    expect(() => cloneFile(userData, to)).toThrow(/not a regular file/);
    expect(existsSync(to)).toBe(false);
  });

  it('the real clone refuses a folder on another device before any copy (macOS)', (ctx) => {
    if (process.platform !== 'darwin') ctx.skip('the guard of `cp -c` is macOS’s; elsewhere the reflink itself refuses another device');
    const from = join(userData, 'a.bin');
    writeFileSync(from, 'x');
    expect(() => cloneFile(from, '/dev/maws-mirror-clone')).toThrow(/another volume/); // devfs: another device, never APFS
    expect(existsSync('/dev/maws-mirror-clone')).toBe(false);
  });
});

// P3-F (F11, the sitting's candidate 18): a document's images are mirrored with it, in `<slug>/assets/` beside its
// `<slug>.md`, whose `src` points there; an image the document drops goes at the next pass by the mirror's leftover rule.
describe('a document’s image assets (P3-F F11)', () => {
  it('mirrors a document’s image where its markdown’s src points, and removes it and its folder once the document drops it', async () => {
    offs.push(registerMirrorWriter('document', documentMirrorWriter));
    await startMirror();
    const space = await linkedSpace();
    const schema = schemaFor();
    const paragraph = (...inline: ReturnType<typeof schema.text>[]) => schema.nodes.doc.create(null, [schema.nodes.paragraph.create({ id: 'p0aaaaaa' }, inline)]);
    let first = '';
    const picture = paragraph(schema.text('See '), schema.nodes.image.create({ src: 'assets/sample-image.png', alt: 'A sample', assetId: 'as1' }));
    const doc = await store().create({ kind: 'document', title: 'Notes', spaceId: space.id, initial: (ydoc) => void (first = createDocument(ydoc, { title: 'Overview', body: picture })) }, human);
    const { ref } = await store().uploadAsset(doc.id, new Uint8Array([137, 80, 78, 71]), { name: 'sample-image.png', mime: 'image/png' }, human);
    expect(ref).toBe('assets/sample-image.png');
    const slug = mirrorSlug(doc);
    await until(() => existsSync(out(slug, 'assets', 'sample-image.png')));
    expect(read(`${slug}.md`)).toContain(`src="${slug}/assets/sample-image.png"`);
    expect([...readFileSync(out(slug, 'assets', 'sample-image.png'))]).toEqual([137, 80, 78, 71]);
    expect(mode(slug, 'assets', 'sample-image.png')).toBe(0o444);

    await store().writeWithAssets(doc.id, human, [], (ydoc) => {
      addTab(ydoc, { title: 'Overview', body: paragraph(schema.text('No picture now.')), after: first });
      deleteTab(ydoc, first);
    });
    await new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50));
    await mirror!.flush();
    expect(listed()).toEqual([MIRROR_MANIFEST, `${slug}.md`]);
    expect(read(`${slug}.md`)).toContain('No picture now.');
  });
});

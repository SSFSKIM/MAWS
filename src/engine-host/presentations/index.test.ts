// P3-C M3 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D7): the host's presentation module registers the
// deck's adapter and its mirror writer, and the mirror writes a deck in a linked Space as Claude-readable files: the
// index without the deck's overrides, each slide with every token replaced by its value in the governing system with
// the overrides over it, a held slide as its source.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenProperties } from '@artifacts/design-system/css';
import { readSystem, setToken, writeSystem } from '@artifacts/design-system/model';
import { builtinView } from '@artifacts/design-system/view';
import { mirrorSlug, mirrorWriterFor } from '@artifacts/library/mirror';
import { slidePath } from '@artifacts/slides/deck';
import { deckFiles } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import { applyV2, newDoc } from '@artifacts/yjs';
import * as Y from '@artifacts/yjs/slides';
import type { Actor } from '@shared/artifacts/actor';
import { DesignSystemChain } from '../design-systems/chain';
import { openDocuments, type Documents } from '../documents';
import { CHANGE_COALESCE_MS } from '../documents/store';
import { LibraryMirror } from '../library/mirror';
import { registerPresentations, type Presentations } from '.';

const HUMAN: Actor = { kind: 'human' };

let userData: string;
let project: string;
let documents: Documents;
let presentations: Presentations;
let mirror: LibraryMirror | null;
let refreshed: string[][]; // P3-C (Decision Log 29): what the module asked the mirror to refresh
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-deck-host-'));
  project = mkdtempSync(join(tmpdir(), 'maws-deck-project-'));
  documents = openDocuments(userData, () => {})!;
  mirror = null;
  refreshed = [];
  // the library's mirror, once a case starts one; the calls recorded either way
  const refresh = (artifactIds: string[]) => (refreshed.push(artifactIds), mirror?.refresh(artifactIds));
  presentations = registerPresentations({ documents, chain: new DesignSystemChain(documents.store, documents.service), refresh });
});
afterEach(() => {
  mirror?.close();
  presentations.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

const HELD = '<section id="broken" style="background:#ffffff">\n<div id="box">loose text</div>\n</section>';

describe('the host’s presentation module (D7)', () => {
  it('registers the adapter and the mirror writer, and removes the writer on close', () => {
    expect(documents.service.adapterFor('presentation')?.paths).toBeTypeOf('function');
    expect(mirrorWriterFor('presentation')).toBeTypeOf('function');
    presentations.close();
    expect(mirrorWriterFor('presentation')).toBeUndefined();
    presentations = registerPresentations({ documents, chain: null, refresh: () => {} }); // afterEach closes it
  });

  it('mirrors a deck in a linked Space with its tokens resolved, the deck’s overrides over the system’s, and a held slide as sent', async () => {
    mirror = new LibraryMirror(documents, { log: () => {} });
    await mirror.start();
    const space = await documents.store.createSpace({ name: 'Talks', linkedDir: project });
    const deck = await documents.store.create({ kind: 'presentation', title: 'Kickoff', spaceId: space.id }, HUMAN);
    await documents.service.writeAs(deck.id, HUMAN, (doc) => {
      Y.setDeckEntry(doc, 'dsOverrides', '--ds-color-bg', '#101010');
      Y.setDeckEntry(doc, 'dsOverrides', '--ds-color-text', 'var(--ds-color-bg)'); // an override naming another
      publishDeck(doc, deckFiles(doc), { [slidePath('broken')]: HELD }, false);
    });
    await mirror.flush();

    const folder = mirrorSlug(deck);
    const out = (...parts: string[]) => join(project, 'artifacts', folder, ...parts);
    expect(readdirSync(out(), { recursive: true }).map(String).sort()).toEqual(['deck.json', 'slides', 'slides/broken.html', 'slides/cover.html']);
    const index = JSON.parse(readFileSync(out('deck.json'), 'utf8')) as Record<string, unknown>;
    expect(index).toMatchObject({ title: 'Kickoff', order: ['cover', 'broken'] });
    expect(index.dsOverrides).toBeUndefined();

    const cover = readFileSync(out('slides', 'cover.html'), 'utf8');
    expect(cover).not.toContain('var(');
    expect(cover).toContain('background:#101010');
    expect(cover).toMatch(/<h1 id="title" style="[^"]*color:#101010/);
    const house = tokenProperties(builtinView().tokens, 'deck'); // no system in the store: the bundled floor governs
    expect(cover).toContain(`font-size:${house.get('--ds-type-title-size')}`);
    expect(readFileSync(out('slides', 'broken.html'), 'utf8')).toBe(HELD);
    expect(existsSync(join(project, 'artifacts', '.maws-mirror.json'))).toBe(true);
  });

  // The final review's A14 (Decision Log 37 (1)): the assets the deck references are copied beside its slides, each read
  // once (a copy already in place is kept), and an asset uploaded after the slide naming it reaches the mirror with no
  // write to the deck (`inputs`).
  it('copies the deck’s referenced assets into its folder, once, and follows an upload that comes after its reference', async () => {
    mirror = new LibraryMirror(documents, { log: () => {} });
    await mirror.start();
    const space = await documents.store.createSpace({ name: 'Talks', linkedDir: project });
    const deck = await documents.store.create({ kind: 'presentation', title: 'Kickoff', spaceId: space.id }, HUMAN);
    const { ref } = await documents.store.uploadAsset(deck.id, new Uint8Array([1, 2, 3]), { name: 'logo.png', mime: 'image/png' }, HUMAN);
    await documents.store.uploadAsset(deck.id, new Uint8Array([7]), { name: 'unused.png', mime: 'image/png' }, HUMAN);
    const settle = () => new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50)); // the store's feed holds a second commit this long
    const slide = (src: string, text: string) => `<section id="s1"><img id="logo" src="${src}" alt=""><p id="t">${text}</p></section>`;
    await documents.service.writeAs(deck.id, HUMAN, (doc) => void publishDeck(doc, deckFiles(doc), { [slidePath('s1')]: slide(ref, 'One') }, false));
    await mirror.flush();
    const out = (...parts: string[]) => join(project, 'artifacts', mirrorSlug(deck), ...parts);
    expect([...readFileSync(out('assets', 'logo.png'))]).toEqual([1, 2, 3]);
    expect(existsSync(out('assets', 'unused.png'))).toBe(false);

    const reads: string[] = [];
    const readAsset = documents.store.files.readAsset.bind(documents.store.files);
    documents.store.files.readAsset = (artifactId, sha256) => (reads.push(sha256), readAsset(artifactId, sha256));
    await documents.service.writeAs(deck.id, HUMAN, (doc) => void publishDeck(doc, deckFiles(doc), { [slidePath('s1')]: slide(ref, 'Two') }, false));
    await settle();
    await mirror.flush();
    expect(readFileSync(out('slides', 's1.html'), 'utf8')).toContain('>Two<');
    expect(reads).toEqual([]); // the copy in place is kept, not read again
    expect([...readFileSync(out('assets', 'logo.png'))]).toEqual([1, 2, 3]);

    await documents.service.writeAs(deck.id, HUMAN, (doc) => void publishDeck(doc, deckFiles(doc), { [slidePath('s1')]: slide('assets/late.png', 'Three') }, false));
    await settle();
    await mirror.flush();
    expect(existsSync(out('assets', 'late.png'))).toBe(false);
    expect(existsSync(out('assets', 'logo.png'))).toBe(false); // no longer referenced
    await documents.store.uploadAsset(deck.id, new Uint8Array([4, 5]), { name: 'late.png', mime: 'image/png' }, HUMAN);
    await settle();
    await mirror.flush();
    expect([...readFileSync(out('assets', 'late.png'))]).toEqual([4, 5]);
  });
});

// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md Decision Log 29; the P3 spec's Decision Log 69): the
// deck's mirror follows the system governing it with no write to the deck: the writer's `inputs` are the governing ref
// and that system's revision, and the module refreshes every deck when a design system changes or the defaults do.
describe('the deck mirror’s freshness under its governing system (Decision Log 29)', () => {
  const official = DEFAULT_SYSTEMS.find((system) => system.key === 'official')!;
  async function officialSystem() {
    const system = await documents.store.create({ kind: 'design_system', title: 'Official' }, HUMAN);
    await documents.service.writeAs(system.id, HUMAN, (doc) => void writeSystem(doc, official.files, { route: 'default', key: 'official', at: 0 }, { name: 'Official' }));
    return system;
  }

  it('declares the deck’s inputs as the governing ref and that system’s revision', async () => {
    const writer = mirrorWriterFor('presentation')!;
    const deck = await documents.store.create({ kind: 'presentation', title: 'Kickoff' }, HUMAN);
    expect(writer.inputs?.(deck)).toBe('builtin:maws');
    const system = await officialSystem();
    const placed = await documents.store.update(deck.id, { designSystemId: system.id });
    expect(writer.inputs?.(placed)).toBe(`${system.id}@${documents.store.revision(system.id)}`);
    await documents.service.writeAs(system.id, HUMAN, (doc) => setToken(doc, 'color.bg.$root', { $value: { colorSpace: 'srgb', components: [0, 0, 0] } }));
    expect(writer.inputs?.(placed)).toBe(`${system.id}@${documents.store.revision(system.id)}`);
  });

  it('refreshes every deck when a design system changes and when the defaults do, and not for another kind', async () => {
    const decks = [await documents.store.create({ kind: 'presentation', title: 'One' }, HUMAN), await documents.store.create({ kind: 'presentation', title: 'Two' }, HUMAN)];
    const ids = decks.map((deck) => deck.id).sort();
    refreshed.length = 0;
    await documents.store.create({ kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>x</p>') } }, HUMAN);
    expect(refreshed).toEqual([]);
    const system = await officialSystem();
    expect(refreshed.length).toBeGreaterThan(0);
    expect(refreshed.every((asked) => [...asked].sort().join() === ids.join())).toBe(true);
    refreshed.length = 0;
    await documents.store.setDefaults({ owner: system.id, spaces: {} });
    expect(refreshed.map((asked) => [...asked].sort())).toEqual([ids]);
  });

  it('rewrites a mirrored deck when the owner’s default changes and when its system is edited, with no write to the deck', async () => {
    mirror = new LibraryMirror(documents, { log: () => {} });
    await mirror.start();
    const space = await documents.store.createSpace({ name: 'Talks', linkedDir: project });
    const deck = await documents.store.create({ kind: 'presentation', title: 'Kickoff', spaceId: space.id }, HUMAN);
    await mirror.flush();
    const cover = () => readFileSync(join(project, 'artifacts', mirrorSlug(deck), 'slides', 'cover.html'), 'utf8');
    const bgOf = (systemId: string) => {
      const doc = newDoc();
      try {
        applyV2(doc, documents.service.readState(systemId).state);
        return tokenProperties(readSystem(doc).tokens, 'deck').get('--ds-color-bg')!;
      } finally {
        doc.destroy();
      }
    };
    const until = async (test: () => boolean) => {
      for (let i = 0; i < 400 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(test()).toBe(true);
    };
    await until(() => existsSync(join(project, 'artifacts', mirrorSlug(deck), 'slides', 'cover.html')));
    const revision = documents.store.revision(deck.id);

    const system = await officialSystem();
    const officialBg = bgOf(system.id);
    expect(cover()).not.toContain(`background:${officialBg}`); // the floor's ground, until the default names the system
    await documents.store.setDefaults({ owner: system.id, spaces: {} });
    await mirror.flush();
    expect(cover()).toContain(`background:${officialBg}`);

    await documents.service.writeAs(system.id, HUMAN, (doc) => setToken(doc, 'color.bg.$root', { $value: { colorSpace: 'srgb', components: [0, 0, 0] } }));
    await mirror.flush();
    const editedBg = bgOf(system.id);
    expect(editedBg).not.toBe(officialBg);
    await until(() => cover().includes(`background:${editedBg}`));
    expect(documents.store.revision(deck.id)).toBe(revision); // the deck itself was never written
  });
});

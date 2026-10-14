// P3-C M3 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D7): the host's presentation module registers the
// deck's adapter and its mirror writer, and the mirror writes a deck in a linked Space as Claude-readable files: the
// index without the deck's overrides, each slide with every token replaced by its value in the governing system with
// the overrides over it, a held slide as its source.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenProperties } from '@artifacts/design-system/css';
import { builtinView } from '@artifacts/design-system/view';
import { mirrorSlug, mirrorWriterFor } from '@artifacts/library/mirror';
import { slidePath } from '@artifacts/slides/deck';
import { deckFiles } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import * as Y from '@artifacts/yjs/slides';
import type { Actor } from '@shared/artifacts/actor';
import { DesignSystemChain } from '../design-systems/chain';
import { openDocuments, type Documents } from '../documents';
import { LibraryMirror } from '../library/mirror';
import { registerPresentations, type Presentations } from '.';

const HUMAN: Actor = { kind: 'human' };

let userData: string;
let project: string;
let documents: Documents;
let presentations: Presentations;
let mirror: LibraryMirror | null;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-deck-host-'));
  project = mkdtempSync(join(tmpdir(), 'maws-deck-project-'));
  documents = openDocuments(userData, () => {})!;
  presentations = registerPresentations({ documents, chain: new DesignSystemChain(documents.store, documents.service) });
  mirror = null;
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
    presentations = registerPresentations({ documents, chain: null }); // afterEach closes it
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
});

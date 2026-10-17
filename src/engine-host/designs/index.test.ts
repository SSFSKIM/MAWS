// P3-E1 M2 (acceptance 6; the parent's Decision Log 13 (3)): the host's design module registers the adapter and the
// mirror writer; L's mirror writes a design in a linked Space as read-only `canvas.json` and `boards/<id>.html` with its
// tokens resolved; a change of the governing system or the defaults, and an uploaded asset the design names, rewrite it
// with no write to the design. A startup mirror of a design no actor has opened since E1 writes its legacy projection
// and invents no migration; malformed legacy input leaves every file the mirror wrote before.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boardPath, CANVAS_PATH } from '@artifacts/design/canvas';
import { tokenProperties } from '@artifacts/design-system/css';
import { readSystem, setToken, writeSystem } from '@artifacts/design-system/model';
import { builtinView } from '@artifacts/design-system/view';
import { publishFiles, readFiles } from '@artifacts/files';
import { mirrorSlug, mirrorWriterFor } from '@artifacts/library/mirror';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { Artifact } from '@shared/artifacts/entity';
import { DesignSystemChain } from '../design-systems/chain';
import { openDocuments, type Documents } from '../documents';
import { CHANGE_COALESCE_MS } from '../documents/store';
import { LibraryMirror } from '../library/mirror';
import { registerDesigns, type Designs } from '.';
import { LEGACY_FILES, logRows, makeLegacyDesign } from './legacy.fixture';

const HUMAN: Actor = { kind: 'human' };

let userData: string;
let project: string;
let documents: Documents;
let designs: Designs;
let mirror: LibraryMirror | null;
let refreshed: string[][];
const start = () => {
  documents = openDocuments(userData, () => {})!;
  mirror = null;
  refreshed = [];
  const refresh = (artifactIds: string[]) => (refreshed.push(artifactIds), mirror?.refresh(artifactIds));
  designs = registerDesigns({ documents, chain: new DesignSystemChain(documents.store, documents.service), refresh });
};
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-design-host-'));
  project = mkdtempSync(join(tmpdir(), 'maws-design-project-'));
});
afterEach(() => {
  mirror?.close();
  designs.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

const startMirror = async () => {
  mirror = new LibraryMirror(documents, { log: () => {} });
  await mirror.start();
  return mirror;
};
const out = (artifact: Pick<Artifact, 'id' | 'title'>, ...parts: string[]) => join(project, 'artifacts', mirrorSlug(artifact), ...parts);
const listed = (artifact: Pick<Artifact, 'id' | 'title'>) => readdirSync(out(artifact), { recursive: true }).map(String).sort();
const settle = () => new Promise((resolve) => setTimeout(resolve, CHANGE_COALESCE_MS + 50)); // the store's feed holds a second commit this long
const publish = (id: string, sent: Record<string, string | null>) =>
  documents.service.writeAs(id, HUMAN, (doc) => {
    const kind = documents.service.adapterFor('design')!;
    void kind.publish!(doc, kind.readFiles!(doc), sent, false);
  });

describe('the host’s design module', () => {
  it('registers the adapter with its migration and the mirror writer, and removes the writer on close', () => {
    start();
    expect(documents.service.adapterFor('design')?.migrate).toBeTypeOf('function');
    expect(mirrorWriterFor('design')).toBeTypeOf('function');
    designs.close();
    expect(mirrorWriterFor('design')).toBeUndefined();
    designs = registerDesigns({ documents, chain: null, refresh: () => {} }); // afterEach closes it
  });

  it('mirrors a design in a linked Space read-only, its tokens resolved in the document medium and its overrides left out', async () => {
    start();
    await startMirror();
    const space = await documents.store.createSpace({ name: 'Launch', linkedDir: project });
    const design = await documents.store.create({ kind: 'design', title: 'Launch', spaceId: space.id }, HUMAN);
    const canvas = JSON.stringify({ v: 1, title: 'Launch', boards: { desktop: { x: 0, y: 0, w: 1440, h: 1024, title: 'Desktop' }, phone: { x: 1600, y: 0, w: 390, h: 844 } }, order: ['desktop', 'phone'], dsOverrides: { '--ds-color-bg': '#101010' } });
    await publish(design.id, { [CANVAS_PATH]: canvas, [boardPath('phone')]: '<section id="phone" style="background:var(--ds-color-bg, #ffffff)"><p id="p" style="font-size:var(--ds-type-body-size, 16px)">Hi</p></section>' });
    await mirror!.flush();

    expect(listed(design)).toEqual(['boards', 'boards/desktop.html', 'boards/phone.html', 'canvas.json']);
    const manifest = JSON.parse(readFileSync(out(design, 'canvas.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ title: 'Launch', order: ['desktop', 'phone'], boards: { phone: { w: 390, h: 844 } } });
    expect(manifest.dsOverrides).toBeUndefined();
    const phone = readFileSync(out(design, 'boards', 'phone.html'), 'utf8');
    expect(phone).not.toContain('var(');
    expect(phone).toContain('background:#101010');
    expect(phone).toContain(`font-size:${tokenProperties(builtinView().tokens, 'document').get('--ds-type-body-size')}`);
    expect(statSync(out(design, 'boards', 'phone.html')).mode & 0o222).toBe(0); // read-only
  });

  it('follows an asset uploaded after a board names it, with no write to the design', async () => {
    start();
    await startMirror();
    const space = await documents.store.createSpace({ name: 'Launch', linkedDir: project });
    const design = await documents.store.create({ kind: 'design', title: 'Launch', spaceId: space.id }, HUMAN);
    await publish(design.id, { [boardPath('desktop')]: '<section id="desktop"><img id="hero" src="assets/hero.png" alt=""></section>' });
    await settle();
    await mirror!.flush();
    expect(existsSync(out(design, 'assets', 'hero.png'))).toBe(false);
    const revision = documents.store.revision(design.id);
    await documents.store.uploadAsset(design.id, new Uint8Array([4, 2]), { name: 'hero.png', mime: 'image/png' }, HUMAN);
    await settle();
    await mirror!.flush();
    expect([...readFileSync(out(design, 'assets', 'hero.png'))]).toEqual([4, 2]);
    expect(documents.store.revision(design.id)).toBe(revision);
  });
});

describe('a mirrored board that becomes held (M2 fix wave)', () => {
  it('keeps every upload on disk while any board is held, whatever spelling its source uses, and cleans up once all boards load again', async () => {
    start();
    await startMirror();
    const space = await documents.store.createSpace({ name: 'Launch', linkedDir: project });
    const design = await documents.store.create({ kind: 'design', title: 'Launch', spaceId: space.id }, HUMAN);
    await documents.store.uploadAsset(design.id, new Uint8Array([4, 2]), { name: 'hero.png', mime: 'image/png' }, HUMAN);
    await documents.store.uploadAsset(design.id, new Uint8Array([7]), { name: 'bg.png', mime: 'image/png' }, HUMAN);
    await documents.store.uploadAsset(design.id, new Uint8Array([9]), { name: 'old.png', mime: 'image/png' }, HUMAN);
    const assetsOnDisk = () => listed(design).filter((file) => file.startsWith('assets/'));
    await publish(design.id, { [boardPath('desktop')]: '<section id="desktop" style="background:url(assets/bg.png) center / cover"><img id="hero" src="assets/hero.png" alt=""><img id="old" src="assets/old.png" alt=""></section>' });
    await settle();
    await mirror!.flush();
    expect(assetsOnDisk()).toEqual(['assets/bg.png', 'assets/hero.png', 'assets/old.png']);

    // the board turns held (loose text in a div); its source names its pictures through a numeric HTML entity and a CSS
    // escape, spellings no literal match finds
    const held = String.raw`<section id="desktop" style="background:url('assets/bge png') center / cover"><div id="box">loose text</div><img id="hero" src="assets/hero&#46;png" alt=""></section>`;
    await publish(design.id, { [boardPath('desktop')]: held });
    await settle();
    await mirror!.flush();
    expect(readFileSync(out(design, 'boards', 'desktop.html'), 'utf8')).toBe(held);
    expect([...readFileSync(out(design, 'assets', 'hero.png'))]).toEqual([4, 2]);
    expect([...readFileSync(out(design, 'assets', 'bg.png'))]).toEqual([7]);
    expect([...readFileSync(out(design, 'assets', 'old.png'))]).toEqual([9]); // retained while a board is held

    // every board loads again: only what the boards name stays
    await publish(design.id, { [boardPath('desktop')]: '<section id="desktop"><img id="hero" src="assets/hero.png" alt=""></section>' });
    await settle();
    await mirror!.flush();
    expect(assetsOnDisk()).toEqual(['assets/hero.png']);
  });
});

describe('the design mirror’s freshness under its governing system', () => {
  const official = DEFAULT_SYSTEMS.find((system) => system.key === 'official')!;

  it('refreshes every design when a design system changes and when the defaults do, and rewrites the mirror with no write to the design', async () => {
    start();
    await startMirror();
    const space = await documents.store.createSpace({ name: 'Launch', linkedDir: project });
    const design = await documents.store.create({ kind: 'design', title: 'Launch', spaceId: space.id }, HUMAN);
    await publish(design.id, { [boardPath('desktop')]: '<section id="desktop" style="background:var(--ds-color-bg, #ffffff)"></section>' });
    await settle();
    await mirror!.flush();
    const board = () => readFileSync(out(design, 'boards', 'desktop.html'), 'utf8');
    const revision = documents.store.revision(design.id);

    refreshed.length = 0;
    const system = await documents.store.create({ kind: 'design_system', title: 'Official' }, HUMAN);
    await documents.service.writeAs(system.id, HUMAN, (doc) => void writeSystem(doc, official.files, { route: 'default', key: 'official', at: 0 }, { name: 'Official' }));
    expect(refreshed.some((asked) => asked.includes(design.id))).toBe(true);
    refreshed.length = 0;
    await documents.store.setDefaults({ owner: system.id, spaces: {} });
    expect(refreshed).toEqual([[design.id]]);
    await mirror!.flush();
    const doc = newDoc();
    applyV2(doc, documents.service.readState(system.id).state);
    expect(board()).toContain(`background:${tokenProperties(readSystem(doc).tokens, 'document').get('--ds-color-bg')}`);
    expect(documents.store.revision(design.id)).toBe(revision);

    // M6: a token of the system that now governs the design edited: the existing board file is rewritten in the new
    // value, still with no write to the design
    const governed = board();
    expect(governed).not.toContain('background:#123456');
    refreshed.length = 0;
    await documents.service.writeAs(system.id, HUMAN, (doc) => setToken(doc, 'color.bg', { $type: 'color', $value: { colorSpace: 'srgb', components: [0x12 / 255, 0x34 / 255, 0x56 / 255], hex: '#123456' } }));
    await settle(); // the store's feed holds a second commit of the system this long
    expect(refreshed.some((asked) => asked.includes(design.id))).toBe(true);
    await mirror!.flush();
    expect(board()).not.toBe(governed);
    expect(board()).toContain('background:#123456');
    expect(documents.store.revision(design.id)).toBe(revision);
  });
});

// M6: the scale gate's host seam (e2e/design-scale.spec.ts): C's deck scale seam, whose artifact_read and
// artifact_publish are A's real tools as an agent's session, opened only under MAWS_E2E=1 with MAWS_DESIGN_PERF naming
// its channel
describe('the design scale gate’s host seam', () => {
  const answer = async (dir: string, name: string, command: Record<string, unknown>) => {
    mkdirSync(join(dir, 'in'), { recursive: true });
    writeFileSync(join(dir, 'in', `${name}.tmp`), JSON.stringify(command));
    renameSync(join(dir, 'in', `${name}.tmp`), join(dir, 'in', name));
    for (let k = 0; k < 200 && !existsSync(join(dir, 'out', name)); k++) await new Promise((resolve) => setTimeout(resolve, 25));
    return JSON.parse(readFileSync(join(dir, 'out', name), 'utf8')) as { ok: boolean; isError?: boolean; result?: { revision: number; files?: Record<string, string>; changed?: string[] }; busyMs?: number; wallMs?: number; loop?: { max: number } };
  };

  it('answers a design’s read and publish as an agent’s session with the host loop around each call', async () => {
    const dir = join(userData, 'design-perf');
    documents = openDocuments(userData, () => {})!;
    mirror = null;
    designs = registerDesigns({ documents, chain: null, refresh: () => {}, env: { MAWS_E2E: '1', MAWS_DESIGN_PERF: dir } });
    const design = await documents.store.create({ kind: 'design', title: 'Scale' }, HUMAN);
    const read = await answer(dir, '00000001.json', { cmd: 'call', session: 'agent', tool: 'artifact_read', args: { artifact: design.id } });
    expect(read).toMatchObject({ ok: true, isError: false });
    expect(Object.keys(read.result!.files!)).toContain(CANVAS_PATH);
    expect(read.loop!.max).toBeGreaterThan(0);
    const board = Object.keys(read.result!.files!).find((path) => path !== CANVAS_PATH)!;
    const sent = read.result!.files![board]!.replace('</section>', '<p id="scaled">Scaled</p></section>');
    const published = await answer(dir, '00000002.json', { cmd: 'call', session: 'agent', tool: 'artifact_publish', args: { artifact: design.id, baseRevision: 'last', files: { [board]: sent } } });
    expect(published).toMatchObject({ ok: true, isError: false, result: { changed: [board] } });
    expect(published.busyMs).toBeGreaterThanOrEqual(0);
    expect(published.wallMs).toBeGreaterThan(0);
  });

  it('is not opened without MAWS_E2E=1 and the channel named', () => {
    start();
    expect(existsSync(join(userData, 'design-perf'))).toBe(false);
    designs.close();
    designs = registerDesigns({ documents, chain: null, refresh: () => {}, env: { MAWS_DESIGN_PERF: join(userData, 'design-perf') } });
    expect(existsSync(join(userData, 'design-perf'))).toBe(false);
  });
});

describe('a startup mirror of a design no actor has opened since E1 (Decision Log 13 (3))', () => {
  it('writes the legacy projection and invents no migration, its update or its actor', async () => {
    const legacy = await makeLegacyDesign(userData, { spaceDir: project });
    start();
    const artifact = documents.store.get(legacy.id)!;
    const rows = logRows(userData, legacy.id);
    await startMirror();
    await mirror!.flush();
    expect(listed(artifact)).toEqual(['boards', 'boards/phone.html', 'boards/poster.html', 'canvas.json']);
    expect(JSON.parse(readFileSync(out(artifact, 'canvas.json'), 'utf8'))).toMatchObject({ title: 'Launch', boards: { poster: { w: 1080, h: 10_000 } } });
    expect(readFileSync(out(artifact, 'boards', 'phone.html'), 'utf8')).toMatch(/<h1 id="t"[^>]*>Sign in<\/h1>/);
    expect(logRows(userData, legacy.id)).toEqual(rows);
    const state = newDoc();
    applyV2(state, documents.service.readState(legacy.id).state);
    expect(readFiles(state)).toEqual(LEGACY_FILES); // still legacy: only an actor's access migrates
  });

  it('keeps every file it mirrored before when the legacy input turns malformed', async () => {
    const legacy = await makeLegacyDesign(userData, { spaceDir: project });
    start();
    const artifact = documents.store.get(legacy.id)!;
    await startMirror();
    await mirror!.flush();
    const before = listed(artifact).map((file) => [file, statSync(out(artifact, file)).isFile() ? readFileSync(out(artifact, file), 'utf8') : null]);
    // an earlier build's write breaking the manifest, still in the generic model
    await documents.service.writeAs(legacy.id, HUMAN, (doc) => void publishFiles(doc, readFiles(doc), { [CANVAS_PATH]: '{"v":' }, false));
    await settle();
    await mirror!.flush().catch(() => {});
    expect(listed(artifact).map((file) => [file, statSync(out(artifact, file)).isFile() ? readFileSync(out(artifact, file), 'utf8') : null])).toEqual(before);
  });
});

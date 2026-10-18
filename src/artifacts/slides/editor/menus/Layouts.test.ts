// P3-C M6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10, "New slide from layout"): the governing system's
// layouts read through the dialect, and a slide made from one: its placeholders' marks stripped, its ids fresh.
import { describe, expect, it, vi } from 'vitest';
import { defaultSystem, HOUSE_KEY } from '../../../types/design_system/defaults';
import { newDoc, transact } from '../../../yjs';
import type { ElementIR } from '../../ir';
import { deckFiles, importSlide, readSlide, slideOrder, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { DeckSession } from '../session';
import { insertLayoutSlide, layoutAssets, layoutsOf, slideFromLayout } from './Layouts';

const maws = defaultSystem(HOUSE_KEY)!;
const walk = (els: readonly ElementIR[]): ElementIR[] => els.flatMap((e) => [e, ...walk(e.children)]);

describe('the design system’s layouts', () => {
  it('lists every layouts/*.html in name order, each loaded with no slide held', () => {
    const layouts = layoutsOf(maws.files);
    expect(layouts.map((l) => [l.name, l.label])).toEqual([
      ['content', 'Content'],
      ['figures', 'Figures'],
      ['quote', 'Quote'],
      ['title', 'Title'],
    ]);
    expect(layouts.every((l) => l.slide !== null)).toBe(true);
    expect(layoutsOf({ 'DESIGN.md': '# x', 'layouts/broken.html': '<section id="broken"><div>' + '<div>'.repeat(20) + '</section>' })).toEqual([
      expect.objectContaining({ name: 'broken', slide: null, reason: expect.any(String) }),
    ]);
  });

  it('makes a slide with no data-ph, fresh element ids and the new id, inserted after the current slide', () => {
    const doc = newDoc();
    const cover = loadSlide('<section id="cover"><h1 id="t">Deck</h1></section>', { fileId: 'cover' });
    if (!cover.ok) throw new Error('fixture');
    transact(doc, () => {
      writeDeckKeys(doc, { v: 4, title: 'T', order: ['cover'] });
      importSlide(doc, cover.slide, 'a0');
    });
    for (const layout of layoutsOf(maws.files)) {
      const made = slideFromLayout(doc, layout.slide!, `from-${layout.name}`);
      expect(made.id).toBe(`from-${layout.name}`);
      const before = walk(layout.slide!.children).map((e) => e.id).filter(Boolean);
      const after = walk(made.children);
      expect(after.some((e) => 'data-ph' in e.attrs)).toBe(false);
      expect(after.map((e) => e.id).filter((id) => id !== '' && before.includes(id))).toEqual([]);
      expect(new Set(after.map((e) => e.id).filter(Boolean)).size).toBe(after.filter((e) => e.id).length);
      transact(doc, () => importSlide(doc, made, `b${layout.name}`));
    }
    expect(slideOrder(doc)).toHaveLength(5);
    // every slide made reads back through the loader with nothing held
    for (const [path, text] of Object.entries(deckFiles(doc))) {
      if (!path.startsWith('project/slides/')) continue;
      const loaded = loadSlide(text, { fileId: path.slice('project/slides/'.length, -'.html'.length) });
      expect(loaded.ok, path).toBe(true);
    }
    expect(readSlide(doc, 'from-title').children.map((c) => c.tag)).toEqual(['p', 'h1', 'p']);
  });
});

// final fix wave (B5): a system's layout names the system's assets, not the deck's
const BRANDED = `<section id="branded" style="background:url(assets/bg.png) center / cover">
<img id="logo" src="assets/logo.png" alt="Logo" style="position:absolute; left:64px; top:64px; width:200px; height:80px">
<h1 id="t" data-ph="title" style="font-size:96px">Title</h1>
</section>`;

describe('a design system’s layout that names its assets (final fix wave B5)', () => {
  function withCover() {
    const doc = newDoc();
    const cover = loadSlide('<section id="cover"><h1 id="t">Deck</h1></section>', { fileId: 'cover' });
    if (!cover.ok) throw new Error('fixture');
    transact(doc, () => {
      writeDeckKeys(doc, { v: 4, title: 'T', order: ['cover'] });
      importSlide(doc, cover.slide, 'a0');
    });
    return new DeckSession(doc);
  }
  const branded = () => layoutsOf({ 'layouts/branded.html': BRANDED })[0]!.slide!;

  it('copies each asset into the deck through copyAsset and inserts the slide naming the copies', async () => {
    const session = withCover();
    const layout = branded();
    expect(layoutAssets(layout)).toEqual(['assets/bg.png', 'assets/logo.png']);
    const copyAsset = vi.fn(async (_from: string, ref: string) => ref.replace('assets/', 'assets/copied-'));
    const inserted = await insertLayoutSlide(session, { slide: layout, system: 'sys-1' }, 'cover', copyAsset);
    expect(copyAsset.mock.calls).toEqual([
      ['sys-1', 'assets/bg.png'],
      ['sys-1', 'assets/logo.png'],
    ]);
    if (!('id' in inserted)) throw new Error(inserted.reason);
    expect(slideOrder(session.doc)).toEqual(['cover', inserted.id]);
    const made = readSlide(session.doc, inserted.id);
    expect(made.style.background).toBe('url(assets/copied-bg.png) center / cover');
    expect(walk(made.children).find((e) => e.tag === 'img')!.attrs.src).toBe('assets/copied-logo.png');
    expect(session.snapshot().pending).toBe(0);
  });

  it('a copy that fails adds no slide and says why', async () => {
    const session = withCover();
    const inserted = await insertLayoutSlide(session, { slide: branded(), system: 'sys-1' }, 'cover', async () => {
      throw new Error('no asset assets/bg.png in sys-1');
    });
    expect(inserted).toEqual({ reason: expect.stringMatching(/no asset assets\/bg\.png/) });
    expect(slideOrder(session.doc)).toEqual(['cover']);
  });

  it('a copy finishing after the tab closed adds nothing', async () => {
    const session = withCover();
    let finish!: (ref: string) => void;
    const inserted = insertLayoutSlide(session, { slide: branded(), system: 'sys-1' }, 'cover', (_from, ref) => (ref === 'assets/bg.png' ? Promise.resolve('assets/copied-bg.png') : new Promise((resolve) => (finish = resolve))));
    await vi.waitFor(() => expect(finish).toBeDefined());
    session.dispose();
    finish('assets/copied-logo.png');
    await expect(inserted).resolves.toEqual({ reason: expect.any(String) });
    expect(slideOrder(session.doc)).toEqual(['cover']);
  });
});

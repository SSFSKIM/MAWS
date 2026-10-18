// P3-C final fix wave (B4; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"): a paste from
// another deck awaits its pictures' copy before it writes; one whose copy finishes after the tab closed, or after the
// deck stopped taking writes, writes nothing, and the session counts it until then (the tab's close guard waits for it).
import { describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../../yjs';
import { importSlide, readFlat, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { DeckSession } from '../session';
import { CLIPBOARD_TYPE, pasteClipboard, type ClipboardContext } from './clipboard';

function deck(): Doc {
  const doc = newDoc();
  const l = loadSlide('<section id="s" style="background:#ffffff"><h2 id="title" style="font-size:64px">Title</h2></section>');
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

const PAYLOAD = {
  v: 1,
  artifactId: 'deck-a',
  html: '<section id="clipboard"><img id="pic" src="assets/cat.png" style="position:absolute; left:100px; top:100px; width:200px; height:100px"></section>',
  assets: ['assets/cat.png'],
};

function pasteEvent(): ClipboardEvent {
  const data = new Map([[CLIPBOARD_TYPE, JSON.stringify(PAYLOAD)]]);
  return { clipboardData: { getData: (type: string) => data.get(type) ?? '' }, preventDefault: () => {} } as unknown as ClipboardEvent;
}

function across() {
  const session = new DeckSession(deck());
  let finish!: (ref: string) => void;
  const ctx = { session, slideId: 's', artifactId: 'deck-b', importAsset: () => new Promise<string>((resolve) => (finish = resolve)) } as unknown as ClipboardContext;
  const pictures = () => readFlat(session.doc, 's', false).filter((e) => e.tag === 'img');
  return { session, ctx, pictures, finish: (ref: string) => finish(ref) };
}

describe('a paste from another deck (final fix wave B4)', () => {
  it('lands with the copied ref when the copy finishes in time, counted until then', async () => {
    const { session, ctx, pictures, finish } = across();
    const pasted = pasteClipboard(pasteEvent(), ctx, []);
    await Promise.resolve();
    expect(session.snapshot().pending).toBe(1);
    finish('assets/cat-1.png');
    await expect(pasted).resolves.toEqual({ ids: ['pic'] });
    expect(pictures().map((e) => e.attrs.src)).toEqual(['assets/cat-1.png']);
    expect(session.snapshot().pending).toBe(0);
  });

  it('writes nothing when the copy finishes after the tab closed', async () => {
    const { session, ctx, pictures, finish } = across();
    const pasted = pasteClipboard(pasteEvent(), ctx, []);
    await Promise.resolve();
    session.dispose();
    finish('assets/cat-1.png');
    await pasted;
    expect(pictures()).toEqual([]);
  });

  it('writes nothing when the copy finishes while a version shows, and says why', async () => {
    const { session, ctx, pictures, finish } = across();
    const pasted = pasteClipboard(pasteEvent(), ctx, []);
    await Promise.resolve();
    session.holdWrites(true);
    finish('assets/cat-1.png');
    await expect(pasted).resolves.toEqual({ reason: expect.stringMatching(/not placed/) });
    expect(pictures()).toEqual([]);
  });
});

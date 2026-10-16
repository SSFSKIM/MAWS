// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"; M5): copy, cut and paste of
// elements within and across decks. The clipboard carries the dialect: the selection as one slide file (MAWS's own type,
// and as `text/html` for anything else), its text as `text/plain`. A paste goes through the loader, so what lands is
// what an agent's publish of the same file would land; ids the slide already holds are re-minted and a pinned copy
// beside its original moves on by 24 px. Plain text pastes as a new text box.
//
// Fix wave 1: a picture's asset belongs to the deck it was uploaded to, so MAWS's own type also names the deck the copy
// came from and the assets its pictures refer to; a paste into another deck brings each asset over first
// (`importAsset`, the shell's: read from the source deck, uploaded into this one) and rewrites the refs before anything
// is written.
//
// Final fix wave (B4): bringing them over is the session's awaited edit (`later`): the tab's close waits for it, and
// the paste lands only if the deck still takes writes when the assets are in.
import { escAttr, escText } from '../../serialize';
import { copyElements, pasteElements } from '../../writers-elements';
import type { GestureContext } from './gestures';
import { slideTree } from './selection';

export const CLIPBOARD_TYPE = 'application/x-maws-slide';
const PASTE_OFFSET = 24;

/** What MAWS's own clipboard type holds. */
export interface ClipboardPayload {
  v: 1;
  /** The deck the copy came from (null when the editor does not know its artifact). */
  artifactId: string | null;
  html: string;
  /** The `assets/<name>` refs the copied pictures name. */
  assets: string[];
}

/** Where a paste reads its source deck's assets from: brings `ref` of `sourceArtifactId` into this deck, answers its ref. */
export type ImportAsset = (sourceArtifactId: string, ref: string) => Promise<string>;

export interface ClipboardContext extends GestureContext {
  /** The deck shown (its artifact). */
  artifactId?: string;
  importAsset?: ImportAsset;
}

/** The text of the copied elements (their HTML's text, a line each). */
function textOf(html: string, document: Document): string {
  const t = document.createElement('template');
  t.innerHTML = html.replace(/<(br|\/p|\/h[123]|\/li|\/tr)>/gi, (m) => `${m}\n`);
  return (t.content.textContent ?? '').replace(/\n{2,}/g, '\n').trim();
}

const ASSET_SRC = /\ssrc="(assets\/[^"]+)"/g;
const assetsOf = (html: string): string[] => [...new Set([...html.matchAll(ASSET_SRC)].map((m) => m[1]!))];

/** Puts the selection on the clipboard (and removes it on a cut). False when there is nothing to copy. */
export function copySelection(event: ClipboardEvent, ctx: ClipboardContext, selection: readonly string[], cut: boolean, remove: () => void): boolean {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const ids = selection.filter((id) => tree.has(id));
  if (!ids.length || !event.clipboardData) return false;
  const html = copyElements(ctx.session.doc, ctx.slideId, ids);
  const payload: ClipboardPayload = { v: 1, artifactId: ctx.artifactId ?? null, html, assets: assetsOf(html) };
  event.clipboardData.setData(CLIPBOARD_TYPE, JSON.stringify(payload));
  event.clipboardData.setData('text/html', html);
  event.clipboardData.setData('text/plain', textOf(html, ctx.canvas.root.ownerDocument));
  event.preventDefault();
  if (cut) remove();
  return true;
}

function payloadOf(data: DataTransfer): ClipboardPayload | null {
  const own = data.getData(CLIPBOARD_TYPE);
  if (own) {
    try {
      const p = JSON.parse(own) as Partial<ClipboardPayload>;
      if (typeof p.html === 'string') return { v: 1, artifactId: typeof p.artifactId === 'string' ? p.artifactId : null, html: p.html, assets: Array.isArray(p.assets) ? p.assets.filter((a): a is string => typeof a === 'string') : [] };
    } catch {
      // not ours after all: read as HTML below
    }
  }
  const html = data.getData('text/html');
  return /<section[\s>]/i.test(html) ? { v: 1, artifactId: null, html, assets: [] } : null;
}

/**
 * Pastes the clipboard into the current slide: the ids pasted, or the reason nothing was (null: nothing to paste). The
 * clipboard is read during the event; bringing another deck's assets over is awaited before the one write.
 */
export async function pasteClipboard(event: ClipboardEvent, ctx: ClipboardContext, selection: readonly string[]): Promise<{ ids: string[] } | { reason: string } | null> {
  const data = event.clipboardData;
  if (!data) return null;
  const payload = payloadOf(data);
  const text = payload ? '' : data.getData('text/plain');
  if (!payload && !text.trim()) return null;
  event.preventDefault();
  const markup = payload?.html ?? `<p style="position:absolute; left:560px; top:480px; width:800px; font-size:40px">${text.trim().split('\n').map(escText).join('<br>')}</p>`;
  const out: { result: ReturnType<typeof pasteElements> } = { result: { ok: false, reason: 'nothing to paste' } };
  const write = (markup: string) => {
    const tree = slideTree(ctx.session.doc, ctx.slideId);
    const last = selection[selection.length - 1];
    const after = last !== undefined && tree.has(last) ? last : null;
    ctx.session.edit((origin) => (out.result = pasteElements(ctx.session.doc, ctx.slideId, markup, { offset: PASTE_OFFSET, after }, origin)));
  };
  if (payload && payload.artifactId !== null && payload.artifactId !== ctx.artifactId && payload.assets.length) {
    const { importAsset } = ctx;
    if (!importAsset) return { reason: 'the copied pictures belong to another deck, and this one cannot bring them over' };
    const source = payload.artifactId;
    const brought = (async () => {
      const refs = new Map<string, string>();
      for (const ref of payload.assets) refs.set(ref, await importAsset(source, ref));
      return markup.replace(ASSET_SRC, (whole, ref: string) => (refs.has(ref) ? ` src="${escAttr(refs.get(ref)!)}"` : whole));
    })();
    try {
      if (!(await ctx.session.later(brought, write))) return { reason: 'the paste was not placed: the deck stopped taking edits here while the copied pictures were brought over' };
    } catch (e) {
      return { reason: `the copied pictures could not be brought over: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else write(markup);
  return out.result.ok ? { ids: out.result.ids } : { reason: out.result.reason };
}

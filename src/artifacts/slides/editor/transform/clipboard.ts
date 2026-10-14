// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"; M5): copy, cut and paste of
// elements within and across decks. The clipboard carries the dialect: the selection as one slide file (MAWS's own type,
// and as `text/html` for anything else), its text as `text/plain`. A paste goes through the loader, so what lands is
// what an agent's publish of the same file would land; ids the slide already holds are re-minted and a pinned copy
// beside its original moves on by 24 px. Plain text pastes as a new text box.
import { escText } from '../../serialize';
import { copyElements, pasteElements } from '../../writers-elements';
import type { GestureContext } from './gestures';
import { slideTree } from './selection';

export const CLIPBOARD_TYPE = 'application/x-maws-slide';
const PASTE_OFFSET = 24;

/** The text of the copied elements (their HTML's text, a line each). */
function textOf(html: string, document: Document): string {
  const t = document.createElement('template');
  t.innerHTML = html.replace(/<(br|\/p|\/h[123]|\/li|\/tr)>/gi, (m) => `${m}\n`);
  return (t.content.textContent ?? '').replace(/\n{2,}/g, '\n').trim();
}

/** Puts the selection on the clipboard (and removes it on a cut). False when there is nothing to copy. */
export function copySelection(event: ClipboardEvent, ctx: GestureContext, selection: readonly string[], cut: boolean, remove: () => void): boolean {
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const ids = selection.filter((id) => tree.has(id));
  if (!ids.length || !event.clipboardData) return false;
  const html = copyElements(ctx.session.doc, ctx.slideId, ids);
  event.clipboardData.setData(CLIPBOARD_TYPE, html);
  event.clipboardData.setData('text/html', html);
  event.clipboardData.setData('text/plain', textOf(html, ctx.canvas.root.ownerDocument));
  event.preventDefault();
  if (cut) remove();
  return true;
}

/** Pastes the clipboard into the current slide: the ids pasted, or the reason nothing was. */
export function pasteClipboard(event: ClipboardEvent, ctx: GestureContext, selection: readonly string[]): { ids: string[] } | { reason: string } | null {
  const data = event.clipboardData;
  if (!data) return null;
  const html = data.getData(CLIPBOARD_TYPE) || (/<section[\s>]/i.test(data.getData('text/html')) ? data.getData('text/html') : '');
  const text = html ? '' : data.getData('text/plain');
  if (!html && !text.trim()) return null;
  event.preventDefault();
  const tree = slideTree(ctx.session.doc, ctx.slideId);
  const last = selection[selection.length - 1];
  const after = last !== undefined && tree.has(last) ? last : null;
  const markup = html || `<p style="position:absolute; left:560px; top:480px; width:800px; font-size:40px">${text.trim().split('\n').map(escText).join('<br>')}</p>`;
  const out: { result: ReturnType<typeof pasteElements> } = { result: { ok: false, reason: 'nothing to paste' } };
  ctx.session.edit((origin) => (out.result = pasteElements(ctx.session.doc, ctx.slideId, markup, { offset: PASTE_OFFSET, after }, origin)));
  return out.result.ok ? { ids: out.result.ids } : { reason: out.result.reason };
}

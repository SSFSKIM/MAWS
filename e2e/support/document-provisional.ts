// P4-A2 (X35): what a document editor draws of the agent's provisional layer and presence, sampled on every DOM change
// by a page-side recorder, so a spec judges the sequence (presence before the layer, the layer before the write, the
// swap without a gap or a double) and not a moment. Shared by the unpaid run (e2e/document-provisional.spec.ts) and
// the paid one (e2e/document-provisional-live.spec.ts).
import type { Page } from '@playwright/test';

/** One change of what the editor under the recorder's root draws. */
export interface DrawnSample {
  at: number; // Date.now() in the page
  // each provisional element: the call it belongs to, its op, who writes it, its text, its resolved colour, and the
  // block it sits in (the nearest `[data-id]` ancestor, or '' when it stands between blocks)
  provisional: { id: string; op: string; by: string; text: string; color: string; inBlock: string }[];
  outlines: string[]; // the presence outlines' names
  // the top-level blocks' own text by id (the layer's widgets and the cursor labels left out): every one, or only those
  // the recorder was given
  blocks: Record<string, string>;
}

/**
 * Records, from now on, every change of what the editor at `rootSelector` draws; answers the samples so far. It observes
 * the editor's root alone (the attributes the layer and presence draw with, the text, the nodes), so the page's other
 * surfaces cost it nothing. `blocks` names the top-level blocks whose text each sample keeps, for a long document whose
 * every sample would otherwise clone the whole of it; without it, every top-level block's.
 */
export async function recordDrawing(page: Page, rootSelector: string, options: { blocks?: string[] } = {}): Promise<() => Promise<DrawnSample[]>> {
  await page.evaluate(
    ({ selector, only }) => {
      const samples: DrawnSample[] = [];
      let last = '';
      (window as unknown as { __drawn: DrawnSample[] }).__drawn = samples;
      const own = (block: Element) => {
        const clone = block.cloneNode(true) as HTMLElement;
        for (const extra of Array.from(clone.querySelectorAll('[data-provisional], .ProseMirror-yjs-cursor'))) extra.remove();
        return (clone.textContent ?? '').replace(/⁠/g, '');
      };
      let root: Element | null = null;
      const drawing = new MutationObserver(() => sample());
      const sample = () => {
        // the root resolved again once the one observed has left the page (the editor remounted), so the record goes on
        if (!root?.isConnected) {
          drawing.disconnect();
          root = document.querySelector(selector);
          if (root) drawing.observe(root, { subtree: true, childList: true, characterData: true, attributeFilter: ['data-provisional', 'data-provisional-op', 'data-agent-editing', 'class', 'style'] });
        }
        const el = root;
        if (!el) return;
        const blocks: Record<string, string> = {};
        const read = only ? only.map((id) => el.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`)) : Array.from(el.querySelectorAll(':scope > [data-id]'));
        for (const block of read) if (block) blocks[block.getAttribute('data-id') ?? ''] = own(block);
        const drawn: Omit<DrawnSample, 'at'> = {
          provisional: Array.from(el.querySelectorAll<HTMLElement>('[data-provisional]')).map((node) => ({
            id: node.getAttribute('data-provisional') ?? '',
            op: node.getAttribute('data-provisional-op') ?? '',
            by: node.getAttribute('data-provisional-by') ?? '',
            text: node.textContent ?? '',
            color: getComputedStyle(node).color,
            inBlock: node.parentElement?.closest('[data-id]')?.getAttribute('data-id') ?? '',
          })),
          outlines: Array.from(el.querySelectorAll<HTMLElement>('[data-agent-editing]')).map((node) => node.getAttribute('data-agent-editing') ?? ''),
          blocks,
        };
        const key = JSON.stringify(drawn);
        if (key === last) return;
        last = key;
        samples.push({ at: Date.now(), ...drawn });
      };
      sample();
      // the body's nodes are watched only to notice a remount: a removed root tells its own observer nothing
      new MutationObserver(() => {
        if (!root?.isConnected) sample();
      }).observe(document.body, { subtree: true, childList: true });
    },
    { selector: rootSelector, only: options.blocks ?? null },
  );
  return () => page.evaluate(() => (window as unknown as { __drawn: DrawnSample[] }).__drawn);
}

/** The call's input as the engine streams it: the JSON in small pieces (the sitting saw about 17 characters per delta). */
export function pieces(json: string, size = 6): string[] {
  const out: string[] = [];
  for (let at = 0; at < json.length; at += size) out.push(json.slice(at, at + size));
  return out;
}

/**
 * The swap judged over the samples from the first that drew the layer of `toolUseId`: no sample in which the block
 * `blockId` shows neither the layer (an op of kind `op`) nor the write (`written` in its text), and none in which it
 * shows both. Answers the offenders, empty when the swap was clean.
 */
export function swapOffenders(samples: DrawnSample[], toolUseId: string, op: string, blockId: string, written: string): { gaps: DrawnSample[]; doubles: DrawnSample[] } {
  const from = samples.findIndex((s) => s.provisional.some((p) => p.id === toolUseId));
  if (from < 0) return { gaps: [], doubles: [] };
  const after = samples.slice(from);
  const layerUp = (s: DrawnSample) => s.provisional.some((p) => p.id === toolUseId && p.op === op);
  const real = (s: DrawnSample) => (s.blocks[blockId] ?? '').includes(written);
  return { gaps: after.filter((s) => !layerUp(s) && !real(s)), doubles: after.filter((s) => layerUp(s) && real(s)) };
}

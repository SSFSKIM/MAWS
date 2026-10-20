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
  blocks: Record<string, string>; // every top-level block's own text by id (the layer's widgets and the cursor labels left out)
}

/** Records, from now on, every change of what the editor at `rootSelector` draws; answers the samples so far. */
export async function recordDrawing(page: Page, rootSelector: string): Promise<() => Promise<DrawnSample[]>> {
  await page.evaluate((selector) => {
    const samples: DrawnSample[] = [];
    let last = '';
    (window as unknown as { __drawn: DrawnSample[] }).__drawn = samples;
    const sample = () => {
      const el = document.querySelector(selector);
      if (!el) return;
      const blocks: Record<string, string> = {};
      for (const block of Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-id]'))) {
        const clone = block.cloneNode(true) as HTMLElement;
        for (const extra of Array.from(clone.querySelectorAll('[data-provisional], .ProseMirror-yjs-cursor'))) extra.remove();
        blocks[block.getAttribute('data-id') ?? ''] = (clone.textContent ?? '').replace(/⁠/g, '');
      }
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
    new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  }, rootSelector);
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

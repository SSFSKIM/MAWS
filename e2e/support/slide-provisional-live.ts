// P4-A2 G2.7 (X35; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R3, G2.7): what a deck's stage draws of
// the agent's provisional layer on one slide, sampled on every DOM change by a page-side recorder, so the paid run
// (e2e/presentations-provisional-live.spec.ts) judges the sequence against the journal's clock: the label, the changed
// element's ghost, the swap. It reads the layer's stable DOM hooks (src/artifacts/slides/editor/provisional/slide.ts):
// the stage layer `[data-provisional-layer="<slide>"]` with `data-provisional-writing` (the call's tool use id) and
// `data-provisional-held`, its `[data-provisional-label]`, the ghost canvas `section[data-provisional-ghost]` whose drawn
// nodes carry `data-provisional-shown` and `data-provisional-key`, the live canvas's `[data-provisional-veiled]`, and the
// filmstrip's `[data-provisional-thumb="<slide>"]`. The judgement over the samples is DOM-free, in
// slide-provisional-judge.ts.
import type { Page } from '@playwright/test';
import type { SlideSample } from './slide-provisional-judge';

/**
 * Records, from now on, every change of what the deck editor at `rootSelector` draws of slide `slide`'s layer on the
 * stage and of element `element` on the live canvas; answers the samples so far. It observes the editor's root alone,
 * through the layer's attributes, the nodes and the text.
 */
export async function recordSlide(page: Page, rootSelector: string, watch: { slide: string; element: string }): Promise<() => Promise<SlideSample[]>> {
  await page.evaluate(
    ({ selector, slide, element }) => {
      const samples: SlideSample[] = [];
      let last = '';
      (window as unknown as { __slideDrawn: SlideSample[] }).__slideDrawn = samples;
      const layerOf = (el: Element) => el.querySelector<HTMLElement>(`[data-provisional-layer="${CSS.escape(slide)}"]`);
      let root: Element | null = null;
      const drawing = new MutationObserver(() => sample());
      const sample = () => {
        // the root resolved again once the one observed has left the page (the editor remounted), so the record goes on
        if (!root?.isConnected) {
          drawing.disconnect();
          root = document.querySelector(selector);
          if (root) drawing.observe(root, { subtree: true, childList: true, characterData: true, attributeFilter: ['data-provisional-writing', 'data-provisional-held', 'data-provisional-shown', 'data-provisional-key', 'data-provisional-veiled', 'data-eid'] });
        }
        const el = root;
        if (!el) return;
        const layer = layerOf(el);
        const ghost = layer?.querySelector('section[data-provisional-ghost]') ?? null;
        // the element's live node: inside the stage's frame for the slide, outside the layer (whose ghost has one too)
        const frame = el.querySelector(`[data-stage-slide="${CSS.escape(slide)}"]`);
        const live = frame ? Array.from(frame.querySelectorAll<HTMLElement>(`[data-eid="${CSS.escape(element)}"]`)).find((node) => node.closest('[data-provisional-layer]') === null) : undefined;
        const drawn: Omit<SlideSample, 'at'> = {
          writing: layer?.getAttribute('data-provisional-writing') ?? null,
          label: layer?.querySelector('[data-provisional-label]')?.textContent ?? null,
          held: layer?.getAttribute('data-provisional-held') ?? null,
          ghost: ghost
            ? Array.from(ghost.querySelectorAll<HTMLElement>('[data-provisional-shown]')).map((node) => ({ key: node.getAttribute('data-provisional-key') ?? '', shown: node.getAttribute('data-provisional-shown') ?? '', text: node.textContent ?? '' }))
            : [],
          live: live ? { text: live.textContent ?? '', veiled: live.hasAttribute('data-provisional-veiled') } : null,
          thumb: el.querySelector(`[data-provisional-thumb="${CSS.escape(slide)}"]`)?.getAttribute('data-provisional-writing') ?? null,
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
    { selector: rootSelector, slide: watch.slide, element: watch.element },
  );
  return () => page.evaluate(() => (window as unknown as { __slideDrawn: SlideSample[] }).__slideDrawn);
}

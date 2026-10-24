// P4-A2 G2 (X35; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G-R3 to G-R6, G2.6): what a deck's stage
// and filmstrip, or a design's boards, draw of an agent's publish as it streams, sampled on every DOM change by a
// page-side recorder, so a spec judges the sequence (the label before any element differs, the text growing before the
// call, the swap without a gap or a double, a protected element never covered) and not a moment. The slides' half of
// e2e/support/document-provisional.ts, over the layer's DOM hooks (src/artifacts/slides/editor/provisional/slide.ts):
// `[data-provisional-layer="<slide>"]` with `data-provisional-writing` and `data-provisional-held`, its
// `[data-provisional-label]`, the ghost canvas `section[data-provisional-ghost]` whose drawn nodes carry
// `data-provisional-shown` and `data-provisional-key`, the live canvas's `[data-provisional-veiled]`, a thumbnail's
// `[data-provisional-thumb]` and a new slide's `li[data-provisional-new-slide]`.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { PerfSeam } from './document-scale';
import { launchMaws, type MawsLaunch } from './launch';
import { hideSurfaces } from './shell';

/** One change of what the deck's (or the design's) surfaces under the recorder's root draw. */
export interface SlideSample {
  at: number; // Date.now() in the page
  // each slide's layer: the call writing it ('' when none), the keys it holds back, its label, the label's colour and
  // where it is drawn on the page (null while it is not shown)
  layers: { slide: string; writing: string; held: string[]; label: string; color: string; labelBox: Box | null }[];
  // the ghost canvases present, by slide (a new board's whole ghost among them)
  ghosts: string[];
  // each element a ghost canvas draws: its slide, its key, why it is drawn (changed, added, moved) and its text
  shown: { slide: string; key: string; kind: string; text: string }[];
  // each live element veiled under the layer, by slide and key
  veiled: { slide: string; key: string }[];
  // the filmstrip: the thumbnails a publish writes (their call, whether the provisional slide is drawn over them, whether
  // the entry is a new slide's ghost), the real entries' slides in their order, and the new slides' ghost entries
  thumbs: { slide: string; writing: string; drawn: boolean; isNew: boolean }[];
  entries: string[];
  newSlides: string[];
  // what each filmstrip entry draws, by slide: a real entry's own thumbnail canvas, a new slide's ghost entry's
  // provisional canvas ('' while the entry holds no drawn slide)
  entryText: Record<string, string>;
  newSlideText: Record<string, string>;
  // a design's new boards being written (G2.4): the board, its call, its frame in world px and whether it is drawn
  /** `painted`: drawn and not held (no ancestor transparent or hidden, as a held new board is). */
  newBoards: { board: string; writing: string; frame: string; drawn: boolean; painted: boolean }[];
  // the live text of the elements the recorder was given, by name (null while absent)
  live: Record<string, string | null>;
  // the text boxes mounted (ARMED or EDIT): the element each is in, its text, and where it is on the page
  boxes: { eid: string; text: string; box: Box }[];
}
/** A rectangle on the page, in CSS px. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ATTRIBUTES = ['data-provisional-layer', 'data-provisional-writing', 'data-provisional-held', 'data-provisional-shown', 'data-provisional-key', 'data-provisional-veiled', 'data-provisional-thumb', 'data-provisional-new-slide', 'data-provisional-new-board', 'data-slide-thumb', 'class', 'hidden'];

/**
 * Records, from now on, every change of what the surfaces at `rootSelector` draw of the provisional layer; answers the
 * samples so far. `live` names the live elements whose text each sample keeps (name → a selector inside the root that
 * finds the live node, never a ghost's). The root may appear later (a deck opened mid-stream) or be remade: it is
 * resolved again once the one observed has left the page.
 */
export async function recordSlides(page: Page, rootSelector: string, live: Record<string, string> = {}): Promise<() => Promise<SlideSample[]>> {
  await page.evaluate(
    ({ selector, named, attributes }) => {
      const samples: SlideSample[] = [];
      let last = '';
      (window as unknown as { __slidesDrawn: SlideSample[] }).__slidesDrawn = samples;
      let root: Element | null = null;
      const drawing = new MutationObserver(() => sample());
      const slideOf = (node: Element) => node.closest('section.maws-slide')?.getAttribute('data-slide') ?? '';
      const sample = () => {
        if (!root?.isConnected) {
          drawing.disconnect();
          root = document.querySelector(selector);
          if (root) drawing.observe(root, { subtree: true, childList: true, characterData: true, attributeFilter: attributes });
        }
        const el = root;
        if (!el) return;
        const all = (css: string) => Array.from(el.querySelectorAll<HTMLElement>(css));
        const rect = (node: Element): Box => {
          const r = node.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        // whether a node paints: not hidden itself, and nothing up its chain transparent or undisplayed (a held label or
        // new board is transparent, which no descendant undoes)
        const paints = (node: Element): boolean => {
          if (getComputedStyle(node).visibility === 'hidden') return false;
          for (let n: Element | null = node; n; n = n.parentElement) {
            const style = getComputedStyle(n);
            if (style.opacity === '0' || style.display === 'none') return false;
          }
          return true;
        };
        // where a node is drawn, or null while it is not shown (no box, hidden, transparent itself or by an ancestor)
        const shownBox = (node: HTMLElement | null): Box | null => {
          if (!node) return null;
          const box = rect(node);
          return box.w > 0 && box.h > 0 && paints(node) ? box : null;
        };
        const drawn: Omit<SlideSample, 'at'> = {
          layers: all('[data-provisional-layer]').map((node) => {
            const label = node.querySelector<HTMLElement>('[data-provisional-label]');
            return {
              slide: node.getAttribute('data-provisional-layer') ?? '',
              writing: node.getAttribute('data-provisional-writing') ?? '',
              held: (node.getAttribute('data-provisional-held') ?? '').split(' ').filter(Boolean),
              label: label?.textContent ?? '',
              color: label ? getComputedStyle(label).backgroundColor : '',
              labelBox: shownBox(label),
            };
          }),
          ghosts: all('section[data-provisional-ghost]').map((node) => node.getAttribute('data-slide') ?? ''),
          shown: all('section[data-provisional-ghost] [data-provisional-shown]').map((node) => ({
            slide: slideOf(node),
            key: node.getAttribute('data-provisional-key') ?? '',
            kind: node.getAttribute('data-provisional-shown') ?? '',
            text: node.textContent ?? '',
          })),
          veiled: all('[data-provisional-veiled]').map((node) => ({ slide: slideOf(node), key: node.getAttribute('data-provisional-veiled') ?? '' })),
          thumbs: all('[data-provisional-thumb]')
            .map((node) => ({ slide: node.getAttribute('data-provisional-thumb') ?? '', writing: node.getAttribute('data-provisional-writing') ?? '', drawn: node.querySelector('section.maws-slide') !== null, isNew: node.closest('li[data-provisional-new-slide]') !== null }))
            .filter((thumb) => thumb.writing !== '' || thumb.drawn),
          entries: all('[data-slide-thumb]').map((node) => node.getAttribute('data-slide-thumb') ?? ''),
          newSlides: all('li[data-provisional-new-slide]').map((node) => node.getAttribute('data-provisional-new-slide') ?? ''),
          entryText: Object.fromEntries(
            all('[data-slide-thumb]').map((node) => {
              const own = Array.from(node.querySelectorAll('section.maws-slide')).find((section) => section.closest('[data-provisional-thumb]') === null);
              return [node.getAttribute('data-slide-thumb') ?? '', own?.textContent ?? ''];
            }),
          ),
          newSlideText: Object.fromEntries(all('li[data-provisional-new-slide]').map((node) => [node.getAttribute('data-provisional-new-slide') ?? '', node.querySelector('[data-provisional-thumb] section.maws-slide')?.textContent ?? ''])),
          newBoards: all('[data-provisional-new-board]').map((node) => ({
            board: node.getAttribute('data-provisional-new-board') ?? '',
            writing: node.getAttribute('data-provisional-writing') ?? '',
            frame: node.getAttribute('data-provisional-frame') ?? '',
            drawn: node.querySelector('[data-provisional-thumb] section.maws-slide') !== null,
            painted: node.querySelector('[data-provisional-thumb] section.maws-slide') !== null && paints(node),
          })),
          live: Object.fromEntries(Object.entries(named).map(([name, css]) => [name, el.querySelector(css)?.textContent ?? null])),
          boxes: all('.deck-textbox').map((node) => ({ eid: node.closest('[data-eid]')?.getAttribute('data-eid') ?? '', text: node.textContent ?? '', box: rect(node) })),
        };
        const key = JSON.stringify(drawn);
        if (key === last) return;
        last = key;
        samples.push({ at: Date.now(), ...drawn });
      };
      sample();
      // the body's nodes are watched only to notice the root appear or be remade: a removed root tells its own observer nothing
      new MutationObserver(() => {
        if (!root?.isConnected) sample();
      }).observe(document.body, { subtree: true, childList: true });
    },
    { selector: rootSelector, named: live, attributes: ATTRIBUTES },
  );
  return () => page.evaluate(() => (window as unknown as { __slidesDrawn: SlideSample[] }).__slidesDrawn);
}

/** The layer of `slide` in a sample, when a call writes it. */
export const layerOf = (sample: SlideSample, slide: string) => sample.layers.find((layer) => layer.slide === slide && layer.writing !== '');
/** The ghost's drawing of element `key` of `slide` in a sample. */
export const shownOf = (sample: SlideSample, slide: string, key: string) => sample.shown.find((node) => node.slide === slide && node.key === key);
export const isVeiled = (sample: SlideSample, slide: string, key: string) => sample.veiled.some((node) => node.slide === slide && node.key === key);
/** Nothing of any call's layer is drawn: no layer writing, no ghost, no veil, no ringed thumbnail, no new slide or board. */
export const nothingDrawn = (sample: SlideSample) =>
  sample.layers.every((layer) => layer.writing === '') &&
  sample.ghosts.length === 0 &&
  sample.shown.length === 0 &&
  sample.veiled.length === 0 &&
  sample.thumbs.length === 0 &&
  sample.newSlides.length === 0 &&
  sample.newBoards.length === 0;

const meets = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/**
 * Rule 4 on the canvas: whether anything of the layer covers a text box in a sample (an element of `slide`'s the box is
 * in drawn or veiled, or a shown label over the box), or the boxes differ from the one expected (`eid` holding `text`).
 */
export function boxDisturbed(sample: SlideSample, slide: string, eid: string, text: string): boolean {
  if (sample.boxes.length !== 1 || sample.boxes[0]!.eid !== eid || sample.boxes[0]!.text !== text) return true;
  if (shownOf(sample, slide, eid) || isVeiled(sample, slide, eid)) return true;
  const box = sample.boxes[0]!.box;
  return sample.layers.some((layer) => layer.labelBox !== null && meets(layer.labelBox, box));
}

/**
 * The swap of element `key` of `slide` judged over the samples from the first that drew it in the ghost: no sample in
 * which the element shows neither the layer nor the write (the live element, `liveName`'s text holding `written`, not
 * veiled), and none in which it shows both. Answers the offenders, empty when the swap was clean; throws when no sample
 * drew the element in the ghost, since a swap never seen is no clean one.
 */
export function slideSwapOffenders(samples: SlideSample[], slide: string, key: string, liveName: string, written: string): { gaps: SlideSample[]; doubles: SlideSample[] } {
  const from = samples.findIndex((s) => shownOf(s, slide, key) !== undefined);
  if (from < 0) throw new Error(`no swap to judge: the ghost never drew ${slide}'s ${key} in ${samples.length} samples`);
  const after = samples.slice(from);
  const layerUp = (s: SlideSample) => shownOf(s, slide, key) !== undefined;
  const real = (s: SlideSample) => (s.live[liveName] ?? '').includes(written) && !isVeiled(s, slide, key);
  return { gaps: after.filter((s) => !layerUp(s) && !real(s)), doubles: after.filter((s) => layerUp(s) && real(s)) };
}

/**
 * A new slide's (or board's) swap, judged from the first sample that drew its ghost (`ghost`): none in which it shows
 * neither the ghost nor its real entry (`real`), and none in which it shows both; throws when no sample drew the ghost.
 */
export function entrySwapOffenders(samples: SlideSample[], ghost: (s: SlideSample) => boolean, real: (s: SlideSample) => boolean): { gaps: SlideSample[]; doubles: SlideSample[] } {
  const from = samples.findIndex(ghost);
  if (from < 0) throw new Error(`no swap to judge: no sample of ${samples.length} drew the ghost`);
  const after = samples.slice(from);
  return { gaps: after.filter((s) => !ghost(s) && !real(s)), doubles: after.filter((s) => ghost(s) && real(s)) };
}

/** A sample cut to what a failure message needs. */
export const brief = (s: SlideSample, t0: number) => ({ at: s.at - t0, layers: s.layers, shown: s.shown, veiled: s.veiled, newBoards: s.newBoards, live: s.live, boxes: s.boxes });

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

/** The artifact's live revision, as A's store answers it. */
export const revisionOf = async (page: Page, artifactId: string): Promise<number> => (await ok<{ artifact: { revision: number } }>(page, 'artifacts.get', { artifactId })).artifact.revision;

export interface SeamApp {
  launch: MawsLaunch;
  /** The launch's profile directory, removed at `close` (a dataset's file can be written there). */
  dir: string;
  page: Page;
  seam: PerfSeam;
  close(): Promise<void>;
}

/**
 * The product app on a fresh profile with the document perf seam on (MAWS_DOCUMENT_PERF=1), whose `stream` feeds a
 * session's provisional emitter a call's input and whose `call` runs the real tool under the same tool-use id; the
 * window at 1600 × 1000, the engine host ready and the seam up.
 */
export async function startWithSeam(prefix: string, env: Record<string, string> = {}): Promise<SeamApp> {
  const userData = mkdtempSync(`/tmp/maws-e2e-${prefix}-`);
  const launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_DOCUMENT_PERF: '1', ...env } });
  const { page } = launch;
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  const seam = new PerfSeam(join(userData, 'document-perf'));
  await expect.poll(() => existsSync(join(seam.dir, 'in')), { message: 'the host seam is up' }).toBe(true);
  return {
    launch,
    dir: userData,
    page,
    seam,
    close: async () => {
      await launch.cleanup();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

/** Close optional surfaces and collapse a visible sidebar through its View action, so the editor is wide. */
export async function collapseChrome(app: SeamApp): Promise<void> {
  await hideSurfaces(app.launch.page);
  if (await app.launch.page.locator('[data-region="sidebar"]').isVisible()) await app.launch.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sidebar.toggle')?.click());
}

/** The artifact opened from the library in an `artifact` main tab; answers the tab. */
export async function openFromLibrary(page: Page, title: string, artifactId: string, ready: string) {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator(ready)).toBeVisible({ timeout: 15_000 });
  return tab;
}

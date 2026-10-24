// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D14, D15; the prior art's A1 to A5,
// research/p4-ux-prior-art.md §2.4): the stage and the boards for assistive technology and the keyboard. The canvas
// already draws real, positioned DOM in the model's own tags, so its nodes are what assistive technology reads (Figma's
// mirror exists because its canvas is WebGL; Decision Log 4): they are named here (A1), focused as the selection is (A3,
// the overlay's), and the stage says only what the focus does not (A2).
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Describe } from '../canvas';
import { TEXT_TAGS } from '../ir';
import { DECK_COPY as C } from './copy';
import { kindName } from './names';
import type { DeckSession } from './session';

/**
 * A1: a stage node's role and name. Text and tables keep their native semantics (their text is their name); a picture
 * its own alt, else "Image"; a group or a box holding elements is a `group` named by what it holds; any other element
 * (a shape, an icon, a connector, a drawing, an embed, a line, an empty box) an `img` named by its kind.
 */
export const describeElement: Describe = (e, children) => {
  if (TEXT_TAGS.has(e.tag as never) || e.tag === 'table' || e.tag === 'tr') return null;
  if (e.tag === 'img') return e.attrs.alt !== undefined ? null : { label: kindName(e, children) };
  const name = kindName(e, children);
  return { role: e.tag === 'div' && (e.attrs['data-group'] !== undefined || children > 0) ? 'group' : 'img', label: name };
};

/** The stage's own focus (A3): the stage's surface itself, or one of its elements' nodes. */
export function stageFocus(surface: Element, target: EventTarget | null): boolean {
  return target === surface || (target instanceof Element && target.hasAttribute('data-eid') && surface.contains(target));
}

/** A2: what the stage's polite status says: a multi-selection's count; nothing for one element (its focus says it) or during an edit. */
export function selectionStatus(selected: number, editing: boolean): string {
  return !editing && selected > 1 ? C.selectedCount(selected) : '';
}

// ---- D14 (tracker row 253): F6 and ⇧F6 cycle an editor's regions, the selection kept

/** One region of an editor's F6 ring: where it is, and what in it takes the focus first (else the field last focused there). */
export interface Region {
  selector: string;
  /** What takes the focus whatever was focused there before (the current slide's thumbnail, the stage itself). */
  target?: (region: HTMLElement) => HTMLElement | null;
  /** The stage never scrolls to show the focus. */
  still?: boolean;
}

/** The deck's ring: the toolbar, the filmstrip (its current slide), the stage, the inspector, the notes and the open rail. */
export const DECK_REGIONS: readonly Region[] = [
  { selector: '.deck-toolbar' },
  { selector: '.deck-filmstrip', target: (r) => r.querySelector<HTMLElement>('[data-current] .deck-thumb-button') }, // a thumbnail's focus shows its slide
  { selector: '[data-stage-surface]', target: (r) => r, still: true }, // its focus goes on to the selection's (A3)
  { selector: '[data-deck-inspector]' },
  { selector: '.deck-notes' },
  { selector: '[data-deck-rail]:not([data-deck-rail="inspector"])' },
];
/** The board's ring: the toolbar, the board list (its current board), the world, the inspector and the open rail. */
export const BOARD_REGIONS: readonly Region[] = [
  { selector: '.deck-toolbar' },
  { selector: '[data-design-rail="boards"]', target: (r) => r.querySelector<HTMLElement>('[data-current] .design-board-row') },
  { selector: '[data-stage-surface]', target: (r) => r, still: true },
  { selector: '[data-design-rail="inspector"]' },
  { selector: '[data-deck-rail]:not([data-deck-rail="inspector"])' },
];

const TABBABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const usable = (el: Element): el is HTMLElement => el.isConnected && !el.matches(':disabled') && el.closest('[hidden], [inert], [aria-hidden="true"]') === null;

/**
 * An editor's F6 ring over its regions as they are drawn (an absent one skipped). It remembers the field last focused in
 * each region (`note`, from a focus inside the editor), so F6 returns to it, or to its namesake when the region drew its
 * fields anew (the inspector, for another selection).
 */
export class RegionRing {
  private readonly last = new Map<string, { el: HTMLElement; label: string | null }>();
  constructor(private readonly regions: readonly Region[]) {}

  note(root: HTMLElement, target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return;
    for (const r of this.regions) {
      if (root.querySelector(r.selector)?.contains(target)) return void this.last.set(r.selector, { el: target, label: target.getAttribute('aria-label') });
    }
  }

  /** Moves the focus to the next region (the previous with `back`) that has something to focus; false when none has. */
  step(root: HTMLElement, back: boolean): boolean {
    const present = this.regions.flatMap((r) => {
      const el = root.querySelector<HTMLElement>(r.selector);
      return el ? [{ r, el }] : [];
    });
    const active = root.ownerDocument.activeElement;
    const at = present.findIndex(({ el }) => active !== null && el.contains(active));
    const n = present.length;
    for (let k = 1; k <= n; k++) {
      const i = at < 0 ? (back ? n - k : k - 1) : (((at + (back ? -k : k)) % n) + n) % n;
      if (i === at) break;
      const { r, el } = present[i]!;
      const target = this.targetOf(r, el);
      if (target) {
        target.focus({ preventScroll: r.still === true });
        return true;
      }
    }
    return false;
  }

  private targetOf(r: Region, el: HTMLElement): HTMLElement | null {
    const own = r.target?.(el);
    if (own && usable(own)) return own;
    const last = this.last.get(r.selector);
    if (last && el.contains(last.el) && usable(last.el)) return last.el;
    const namesake = last?.label ? Array.from(el.querySelectorAll(TABBABLE)).find((c) => c.getAttribute('aria-label') === last.label) : undefined;
    if (namesake && usable(namesake)) return namesake;
    return Array.from(el.querySelectorAll(TABBABLE)).find(usable) ?? null;
  }
}

/**
 * An editor root's F6 (⇧F6 back), from React or a native bubble listener with an explicit root: true when the key is the editor's. It steps
 * aside while an input method composes, for a key something earlier took, and for one the owner's keymap binds
 * (`bindsKey`, the shell's). An edit ends first, as a press outside the stage ends it; the armed box then unmounts as
 * the focus leaves (T23: SEL), and arms again when the stage is focused again.
 */
export function regionKey(event: ReactKeyboardEvent<HTMLElement> | KeyboardEvent, ring: RegionRing, session: DeckSession, bindsKey?: (event: KeyboardEvent) => boolean, root = event.currentTarget): boolean {
  if (event.key !== 'F6' || event.metaKey || event.ctrlKey || event.altKey) return false;
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  if (event.defaultPrevented || native.isComposing || native.keyCode === 229 || session.snapshot().composing || bindsKey?.(native)) return false;
  if (session.snapshot().editingText !== null) session.editText(null);
  if (root instanceof HTMLElement && ring.step(root, event.shiftKey)) event.preventDefault();
  return true;
}

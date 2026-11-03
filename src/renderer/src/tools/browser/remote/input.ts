// P5 O17 M10 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M10's Decisions; Interfaces §G's BrowserInput): what a
// person's pointer, wheel and keys on the agent's remote page become. Pure, so the canvas (./View.tsx) only reads events.
//
// - The frame is drawn fitted in its box with letterboxing (`object-fit: contain`): `fitImage` is the image's rectangle,
//   and a point is mapped through it into the tab's viewport (the frame's `viewport`, DIP, whatever the JPEG's pixels). A
//   point in the letterbox is refused; while a drag holds a button it is clamped to the image's edge, so the release the
//   page saw a press of always lands.
// - Keys: a printable key is its press, its text (the page inserts text only from `text`, §G), then its release; a named
//   key or a Control chord is its press alone. A key the IME is composing is left to its commit, which the canvas sends
//   as one `text`. Escape releases the keyboard (the canvas blurs and the page hears `blur`); a Command chord is the
//   app's (its shortcuts), so it is passed on, never sent and never prevented.
import type * as z from 'zod';
import { BROWSER_LIMITS, BROWSER_MODIFIERS, type BrowserInputSchema } from '@shared/browser/screencast';

/** One input as `browser.remote.input` carries it (§G's BrowserInput, its modifiers the four names). */
export type RemoteInput = z.infer<typeof BrowserInputSchema>;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Modifier = (typeof BROWSER_MODIFIERS)[number];
type ModifierKeys = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

const KEY_MAX = 64; // §G's bound on `key` and `code`
const WHEEL_MAX = 10_000; // §G's bound on a wheel's delta, DIP
const LINE_PX = 40; // a wheel's line (deltaMode 1), as Chromium scrolls one
const CLICK_MS = 500; // a second press within it, near the first, is a double click
const CLICK_PX = 4;

/** The image's rectangle within `box`, fitted whole and centred; null while either has no area. */
export function fitImage(box: Box, frame: Size): Box | null {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** The viewport point under client point (x, y); null outside the image unless `clamp` (a drag holding a button). */
export function pointAt(image: Box, viewport: Size, clientX: number, clientY: number, clamp: boolean): Point | null {
  let u = (clientX - image.left) / image.width;
  let v = (clientY - image.top) / image.height;
  const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
  if (!inside && !clamp) return null;
  u = Math.min(1, Math.max(0, u));
  v = Math.min(1, Math.max(0, v));
  const round = (n: number) => Math.round(n * 100) / 100;
  return { x: round(u * viewport.width), y: round(v * viewport.height) };
}

export const modifiersOf = (keys: ModifierKeys): Modifier[] => {
  const held: Modifier[] = [];
  if (keys.altKey) held.push('Alt');
  if (keys.ctrlKey) held.push('Control');
  if (keys.metaKey) held.push('Meta');
  if (keys.shiftKey) held.push('Shift');
  return held;
};

const BUTTONS = ['left', 'middle', 'right'] as const; // the DOM's `button` 0, 1, 2
export type PointerButton = (typeof BUTTONS)[number];
export const buttonOf = (button: number): PointerButton | null => BUTTONS[button] ?? null;

/** A pointer's move, press or release at `at`; null for a button §G has no name for (back, forward). */
export function pointerInput(type: 'move' | 'down' | 'up', event: ModifierKeys & { button: number; buttons: number }, at: Point, clickCount: number): RemoteInput | null {
  const button = type === 'move' ? 'left' : buttonOf(event.button);
  if (button === null) return null;
  return { kind: 'pointer', type, x: at.x, y: at.y, button, buttons: event.buttons & 7, clickCount: type === 'move' ? 0 : Math.min(3, Math.max(1, clickCount)), modifiers: modifiersOf(event) };
}

/** The release of `button`, held down, at `at`: a cancelled pointer's, whose own event names no button. */
export function pointerRelease(button: PointerButton, keys: ModifierKeys, at: Point, clickCount: number): RemoteInput {
  return { kind: 'pointer', type: 'up', x: at.x, y: at.y, button, buttons: 0, clickCount: Math.min(3, Math.max(1, clickCount)), modifiers: modifiersOf(keys) };
}

/** A person's click count: a press soon after the last, near it and with the same button, counts on, to three. */
export class ClickCounter {
  #last: { button: PointerButton; at: Point; time: number; count: number } | null = null;
  constructor(private readonly now: () => number = () => performance.now()) {}

  down(button: PointerButton, at: Point): number {
    const time = this.now();
    const last = this.#last;
    const near = last !== null && last.button === button && time - last.time <= CLICK_MS && Math.abs(at.x - last.at.x) <= CLICK_PX && Math.abs(at.y - last.at.y) <= CLICK_PX;
    const count = near ? Math.min(3, last.count + 1) : 1;
    this.#last = { button, at, time, count };
    return count;
  }

  /** The count of the press this release ends. */
  up(button: PointerButton): number {
    return this.#last?.button === button ? this.#last.count : 1;
  }
}

/** A wheel at `at`, its deltas in pixels (lines and pages converted), bounded. */
export function wheelInput(event: ModifierKeys & { deltaX: number; deltaY: number; deltaMode: number }, at: Point, viewport: Size): RemoteInput {
  const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? viewport.height : 1;
  const bound = (delta: number) => Math.min(WHEEL_MAX, Math.max(-WHEEL_MAX, delta * unit));
  return { kind: 'wheel', x: at.x, y: at.y, deltaX: bound(event.deltaX), deltaY: bound(event.deltaY), modifiers: modifiersOf(event) };
}

type KeyEventLike = ModifierKeys & { key: string; code: string; repeat: boolean; isComposing: boolean; keyCode: number };

/**
 * What a key press or release sends: the inputs in order; `release` (Escape: the canvas lets the keyboard go); `pass` (a
 * Command chord, the app's). An IME's composing key, and a key §G cannot carry, send nothing.
 */
export function keyInputs(type: 'down' | 'up', event: KeyEventLike): RemoteInput[] | 'release' | 'pass' {
  if (event.metaKey) return 'pass';
  if (event.isComposing || event.keyCode === 229) return [];
  if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.shiftKey) return type === 'down' ? 'release' : [];
  if (event.key === '' || event.key.length > KEY_MAX || event.code.length > KEY_MAX) return [];
  const press: RemoteInput = { kind: 'key', type, key: event.key, code: event.code, repeat: event.repeat, modifiers: modifiersOf(event) };
  const printable = [...event.key].length === 1 && !event.ctrlKey;
  return type === 'down' && printable ? [press, { kind: 'text', text: event.key }] : [press];
}

/** Committed text (an IME's composition, a paste) as `text` inputs within §G's bound, in order; none for empty text. */
export function textInputs(text: string): RemoteInput[] {
  const inputs: RemoteInput[] = [];
  const encoder = new TextEncoder();
  let part = '';
  let bytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).byteLength;
    if (bytes + size > BROWSER_LIMITS.textBytes) {
      inputs.push({ kind: 'text', text: part });
      part = '';
      bytes = 0;
    }
    part += char;
    bytes += size;
  }
  if (part !== '') inputs.push({ kind: 'text', text: part });
  return inputs;
}

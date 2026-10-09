// Who gave the page its input (E4a execution document, Design §11; A-33; E4-0's findings-pass2.txt:72-170). The page
// itself cannot tell (every event is trusted, CDP input carries real screen coordinates), and the preload can only
// report; attribution is main's, read from three webContents hooks:
//
//   - `before-input-event` fires for native keys only (CDP keys never raise it), so its keyDown is the human's; its
//     keyUp and the `char` that follows are the same key and are not counted again.
//   - `input-event` (the top frame's widget only) carries the raw `_modifiers`, in which Chromium sets kFromDebugger
//     (bit 23) on every event `Input.dispatchKeyEvent` or `Input.dispatchMouseEvent` injects: a keyDown or rawKeyDown
//     with the bit is the agent's (the human's was counted on the first hook), and a mouseWheel is the agent's with the
//     bit and the human's without (no other hook sees a human wheel). Mouse events here have no modifiers at all.
//   - `before-mouse-event` reaches iframes too, but carries no modifiers: a mouseDown or mouseUp is the agent's exactly
//     when an `Input.dispatchMouseEvent` of the matching type (mousePressed, mouseReleased) is in flight in the tab's
//     TabDebugger and not yet consumed by an earlier event; it then consumes it. Otherwise it is the human's. No
//     coordinates enter the match (zoom and iframes put the hooks in other spaces than the command).
//
// Moves and derived gestures are not events of record. Each attribution is emitted on the tab's input seam, which keeps
// `lastHumanAt` (any human input, wheels included: E4c's hand-back timer), `lastHumanActivationAt` (a human key or mouse
// press: the clipboard carve-out) and `lastActivationAt` (anyone's key or mouse press: the `window.open` gate); a wheel
// is never an activation, as in Chrome, so scrolling opens neither gate (Decision Log 45). E11 (tracker row E4a
// "activation gates count taken chords and Esc"): nor, as in Chrome, is Esc or a browser shortcut, here the chords
// keys.ts takes from the page (⌘R, ⌘[, ⌘], ⌘L, ⌘F, zoom): the human's input, never an activation. The bit is
// undocumented and slated for removal upstream; input.test.ts pins it to the Electron the recordings were made on, and
// E4c carries A-33's fallbacks.
import type { Event, Input, InputEvent, MouseInputEvent } from 'electron';
import type { InFlightKind } from './debugger';
import { keyAction } from './keys';
import type { TabEntry, TabInput } from './tabs';

// WebInputEvent::kFromDebugger: "Indication this event was injected by the devtools" (Chromium 152.0.7977.130).
export const FROM_DEBUGGER = 1 << 23;

export type InputHook = 'before-input-event' | 'input-event' | 'before-mouse-event';
// `chrome`: a command the person gave the tab from outside its page (navigation.ts), which no hook here sees
export type InputKind = 'key' | 'mouse' | 'wheel' | 'chrome';
export type InputSource = 'human' | 'agent';

export interface Attribution {
  kind: InputKind;
  source: InputSource;
  consumes?: InFlightKind; // the in-flight command this event is the agent's through
  activation?: false; // E11: a key press that is no activation (Esc, a chord the browser takes)
}

// An event as the hooks hand it over; `_modifiers` is the raw integer Electron leaves on keyboard and wheel events,
// the key and its modifiers the fields `before-input-event`'s Input carries.
export interface HookEvent {
  type: string;
  _modifiers?: number;
  key?: string;
  meta?: boolean;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
}

// E11: Esc with any modifiers, or a chord keys.ts takes in some state (Esc's own states included)
function reservedKey(event: HookEvent): boolean {
  if (event.key === 'Escape') return true;
  const input = { type: 'keyDown' as const, key: event.key ?? '', meta: event.meta ?? false, control: event.control ?? false, alt: event.alt ?? false, shift: event.shift ?? false };
  return keyAction(input, { findOpen: true, loading: true }) !== null;
}

const fromDebugger = (event: HookEvent) => typeof event._modifiers === 'number' && (event._modifiers & FROM_DEBUGGER) !== 0;

// The decision table (Design §11): every combination not listed attributes nothing.
export function classify(hook: InputHook, event: HookEvent, inFlight: (kind: InFlightKind) => boolean): Attribution | null {
  switch (hook) {
    case 'before-input-event':
      if (event.type !== 'keyDown') return null;
      return reservedKey(event) ? { kind: 'key', source: 'human', activation: false } : { kind: 'key', source: 'human' };
    case 'input-event':
      if (event.type === 'mouseWheel') return { kind: 'wheel', source: fromDebugger(event) ? 'agent' : 'human' };
      if ((event.type === 'keyDown' || event.type === 'rawKeyDown') && fromDebugger(event)) return { kind: 'key', source: 'agent' };
      return null;
    case 'before-mouse-event': {
      const kind: InFlightKind | null = event.type === 'mouseDown' ? 'mousePressed' : event.type === 'mouseUp' ? 'mouseReleased' : null;
      if (kind === null) return null;
      return inFlight(kind) ? { kind: 'mouse', source: 'agent', consumes: kind } : { kind: 'mouse', source: 'human' };
    }
  }
}

export interface InputEmission {
  kind: InputKind;
  source: InputSource;
  at: number; // epoch ms
  activation?: false; // E11: not an activation (Esc, a taken chord); a wheel never is one
}

// A tab's input seam: the last input times its readers check, and the emissions E4c's control transitions consume.
export class TabInputSeam implements TabInput {
  lastHumanAt: number | null = null;
  lastHumanActivationAt: number | null = null;
  lastActivationAt: number | null = null;
  private readonly listeners = new Set<(emission: InputEmission) => void>();

  emit(emission: InputEmission): void {
    const human = emission.source === 'human';
    if (human) this.lastHumanAt = emission.at;
    if (emission.kind !== 'wheel' && emission.activation !== false) {
      this.lastActivationAt = emission.at;
      if (human) this.lastHumanActivationAt = emission.at;
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(emission);
      } catch (error) {
        console.error('[browser] an input listener failed:', error);
      }
    }
  }

  on(listener: (emission: InputEmission) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

// Wires a new view's three hooks into the tab's seam (the store's `onViewCreated`); a view no longer the tab's records
// nothing. Without a debugger (none attached in E4a unless focus emulation is on), nothing is in flight: every press is
// the human's.
export function attachInputSeams(entry: TabEntry, now: () => number = Date.now): void {
  const view = entry.view!;
  const wc = view.webContents;
  const inFlight = (kind: InFlightKind) => entry.debugger?.inFlight(kind) ?? false;
  const record = (hook: InputHook, event: HookEvent) => {
    if (entry.view !== view) return;
    const attribution = classify(hook, event, inFlight);
    if (!attribution) return;
    if (attribution.consumes) entry.debugger?.consume(attribution.consumes);
    entry.input.emit({ kind: attribution.kind, source: attribution.source, at: now(), ...(attribution.activation === false ? { activation: false as const } : {}) });
  };
  wc.on('before-input-event', (_event: Event, input: Input) => record('before-input-event', input));
  wc.on('input-event', (_event: Event, input: InputEvent) => record('input-event', input as InputEvent & HookEvent));
  wc.on('before-mouse-event', (_event: Event, mouse: MouseInputEvent) => record('before-mouse-event', mouse));
}

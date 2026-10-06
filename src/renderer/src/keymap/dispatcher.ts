// Where keys and menu events become actions (C5 execution document, Keyboard runtime; residue *Keyboard map*). The
// application menu's `layout.action` events run their action, and main learns which actions have a handler so the
// menu can disable the rest (`connectActions`). Renderer-sink chords are matched by one capture-phase `keydown`
// listener on the window (`connectKeys`) against the effective keymap, and reach only a binding whose element owns the
// key (`useKeyChord`): the dispatcher refuses outright when the key belongs to something else (see `refused`). E9: a hold
// action (`ActionSpec.hold`) is also told when its hold ends, through capture-phase `keyup`, `blur` and
// `visibilitychange` listeners (see "Hold semantics" below).
import type { MawsBridge } from '@shared/ipc/schema';
import { ACTIONS, ACTION_IDS, effectiveChord, type ActionId, type ActionSpec, type KeymapOverrides } from '@shared/keymap/actions';
import { matchesChord, parseChord, type Chord } from '@shared/keymap/chord';
import { ipc } from '../ipc/client';
import { useSettings } from '../stores/settings';
import { enabledActions, runAction, subscribeActions } from './actions-runtime';
import { bindingsOf, onUnbind, type ChordBinding, type HoldRelease } from './useKeyChord';

export function connectActions(client: MawsBridge = ipc): () => void {
  let connected = true;
  let queued = false;
  // Registrations come in bursts (a component tree mounting); main hears the settled set once per burst.
  const report = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!connected) return;
      void client.invoke('layout.setEnabledActions', { actions: enabledActions() }).then((result) => {
        if (!result.ok) console.warn('[actions] layout.setEnabledActions failed', result.error);
      });
    });
  };
  const offEvent = client.on('layout.action', ({ action, arg }) => runAction(action, arg));
  const offRegistry = subscribeActions(report);
  report();
  return () => {
    connected = false;
    offEvent();
    offRegistry();
  };
}

// ---- renderer-sink keys ---------------------------------------------------------------------------------------------

const RENDERER_ACTIONS = ACTION_IDS.filter((id) => ACTIONS[id].sink === 'renderer');
// Inputs that take a keypress as a click, not as text: they are buttons, refused as buttons are.
export const BUTTON_LIKE_INPUTS: ReadonlySet<string> = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image']);
// A Radix menu, dialog or popover while open (their content carries the role and `data-state="open"`). A sidebar row's
// hover card is not one: it opens under the pointer without taking focus (W5 puts one on every row), and a key from
// inside it lands on a button, which the pane scope refuses anyway.
const OPEN_OVERLAY = ['menu', 'dialog', 'alertdialog'].map((role) => `[role="${role}"][data-state="open"]:not([data-hover-card])`).join(', ');

function isTextEntry(element: Element): boolean {
  if (element instanceof HTMLInputElement) return !BUTTON_LIKE_INPUTS.has(element.type);
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

const isButtonOrLink = (element: Element) =>
  element.closest('button, a[href], [role="button"], [role="link"]') !== null || (element instanceof HTMLInputElement && BUTTON_LIKE_INPUTS.has(element.type));

// Why a key may not reach a binding of this scope at all, before any binding is looked at.
function refused(event: KeyboardEvent, scope: (typeof ACTIONS)[ActionId]['scope'], target: Element): boolean {
  if (event.isComposing) return true;
  // Old persisted overrides must not turn ordinary typing into an app-wide action either.
  if (scope === 'app') return !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1;
  if (document.querySelector(OPEN_OVERLAY) !== null) return true;
  if (scope === 'composer') return target.closest('[data-key-sink="composer"]') === null;
  // Pane scope: Enter and Escape answer requests, so they come only from the card or pane that holds focus itself.
  return isTextEntry(target) || target.closest('[data-key-sink]') !== null || isButtonOrLink(target);
}

// Among the bindings whose element contains both the target and the focused element, the innermost; of two on one
// element, the later registration. Elements containing a common node are nested, so "innermost" is well defined.
function owner(id: ActionId, target: Element): ChordBinding | null {
  const scope = ACTIONS[id].scope;
  const focused = document.activeElement;
  let best: ChordBinding | null = null;
  for (const binding of bindingsOf(id)) {
    const element = binding.within?.current ?? null;
    if (scope !== 'app' && (element === null || !element.contains(target) || focused === null || !element.contains(focused))) continue;
    const bestElement = best?.within?.current ?? null;
    const inner = best === null || (element !== null && bestElement !== null && element !== bestElement && bestElement.contains(element));
    const later = best !== null && element === bestElement && binding.order > best.order;
    if (inner || later) best = binding;
  }
  return best;
}

// ---- E9 start: hold actions (E9 execution document, Design §5 "Hold semantics") --------------------------------------
// A hold action's binding runs on the accepted keydown and is latched with the physical key (`code`) and the chord it
// matched. The capture's end and the key's suppression are two events: the hold is released (once) when the latched
// key or any modifier of the chord comes up, but the key's own repeats stay swallowed until its own keyup, so letting
// ⌥ go first does not let a still-held Space type spaces. Blur and a hidden document release with 'lost' and clear the
// latch. The latch holds the binding itself, so a keymap change or a re-render between down and up loses nothing.
interface Latch {
  binding: ChordBinding;
  code: string;
  chord: Chord;
  released: boolean;
}
let latch: Latch | null = null;

// Ends the latched hold once (the binding's `release`); 'lost' also clears the latch.
export function releaseHold(reason: HoldRelease): void {
  const held = latch;
  if (held === null) return;
  if (reason === 'lost') latch = null;
  if (held.released) return;
  held.released = true;
  try {
    held.binding.release?.(reason);
  } catch (error) {
    console.error(`[keys] ${held.binding.id} release failed`, error);
  }
}

const MODIFIER_OF: Record<string, keyof Omit<Chord, 'key'>> = { Alt: 'alt', Meta: 'meta', Control: 'ctrl', Shift: 'shift' };

function holdKeyUp(event: KeyboardEvent): void {
  if (latch === null) return;
  if (event.code === latch.code) {
    releaseHold('keyup');
    latch = null;
    return;
  }
  const modifier = MODIFIER_OF[event.key];
  if (modifier !== undefined && latch.chord[modifier]) releaseHold('keyup');
}

// A binding that goes away mid-hold (its component unmounted) is released as lost.
onUnbind((binding) => {
  if (latch?.binding === binding) releaseHold('lost');
});
// E9 end

// Runs the binding a keydown belongs to and takes the key's default away; a key nobody owns is left untouched.
export function dispatchKey(event: KeyboardEvent, keymap: KeymapOverrides): boolean {
  if (!(event.target instanceof Element)) return false;
  // E9: the held key's repeats, with or without the chord's modifiers still down, are swallowed until its own keyup
  if (latch !== null && event.code === latch.code) {
    event.preventDefault();
    return true;
  }
  const target = event.target;
  // C11 start: the Settings tab's chord capture is recording this key (settings-tab/KeymapSection.tsx): it runs nothing
  if (target.closest('[data-chord-capture]') !== null) return false;
  // C11 end
  for (const id of RENDERER_ACTIONS) {
    const accelerator = effectiveChord(id, keymap);
    if (accelerator === null) continue;
    const chord = parseChord(accelerator);
    if (!matchesChord(event, chord)) continue;
    if (refused(event, ACTIONS[id].scope, target)) continue;
    const binding = owner(id, target);
    if (!binding) continue;
    event.preventDefault();
    // E9: a hold action latches before it runs, so a release its handler causes finds the latch
    if ((ACTIONS[id] as ActionSpec).hold) {
      releaseHold('lost');
      latch = { binding, code: event.code, chord, released: false };
    }
    try {
      binding.run(null);
    } catch (error) {
      console.error(`[keys] ${id} failed`, error);
    }
    return true;
  }
  return false;
}

export function connectKeys(target: Window = window, keymap: () => KeymapOverrides = () => useSettings.getState().state?.settings.keymap ?? {}): () => void {
  const onKeyDown = (event: KeyboardEvent) => void dispatchKey(event, keymap());
  // E9: a hold's end (Design §5)
  const onKeyUp = (event: KeyboardEvent) => holdKeyUp(event);
  const onBlur = () => releaseHold('lost');
  const onVisibility = () => {
    if (target.document.visibilityState === 'hidden') releaseHold('lost');
  };
  target.addEventListener('keydown', onKeyDown, { capture: true });
  target.addEventListener('keyup', onKeyUp, { capture: true });
  target.addEventListener('blur', onBlur);
  target.document.addEventListener('visibilitychange', onVisibility);
  return () => {
    target.removeEventListener('keydown', onKeyDown, { capture: true });
    target.removeEventListener('keyup', onKeyUp, { capture: true });
    target.removeEventListener('blur', onBlur);
    target.document.removeEventListener('visibilitychange', onVisibility);
    latch = null;
  };
}

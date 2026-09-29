// Where keys and menu events become actions (C5 execution document, Keyboard runtime; residue *Keyboard map*). The
// application menu's `layout.action` events run their action, and main learns which actions have a handler so the
// menu can disable the rest (`connectActions`). Renderer-sink chords are matched by one capture-phase `keydown`
// listener on the window (`connectKeys`) against the effective keymap, and reach only a binding whose element owns the
// key (`useKeyChord`): the dispatcher refuses outright when the key belongs to something else (see `refused`).
import type { MawsBridge } from '@shared/ipc/schema';
import { ACTIONS, ACTION_IDS, effectiveChord, type ActionId, type KeymapOverrides } from '@shared/keymap/actions';
import { matchesChord, parseChord } from '@shared/keymap/chord';
import { ipc } from '../ipc/client';
import { useSettings } from '../stores/settings';
import { enabledActions, runAction, subscribeActions } from './actions-runtime';
import { bindingsOf, type ChordBinding } from './useKeyChord';

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
// A Radix menu, dialog or popover while open (their content carries the role and `data-state="open"`).
const OPEN_OVERLAY = ['menu', 'dialog', 'alertdialog'].map((role) => `[role="${role}"][data-state="open"]`).join(', ');

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
  if (scope === 'app') return false;
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

// Runs the binding a keydown belongs to and takes the key's default away; a key nobody owns is left untouched.
export function dispatchKey(event: KeyboardEvent, keymap: KeymapOverrides): boolean {
  if (!(event.target instanceof Element)) return false;
  const target = event.target;
  for (const id of RENDERER_ACTIONS) {
    const chord = effectiveChord(id, keymap);
    if (chord === null || !matchesChord(event, parseChord(chord))) continue;
    if (refused(event, ACTIONS[id].scope, target)) continue;
    const binding = owner(id, target);
    if (!binding) continue;
    event.preventDefault();
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
  target.addEventListener('keydown', onKeyDown, { capture: true });
  return () => target.removeEventListener('keydown', onKeyDown, { capture: true });
}

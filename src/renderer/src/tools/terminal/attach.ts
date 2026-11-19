// The terminal's "Attach selection to chat" (UX wave U6b-5a, M2; docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-
// keyboard.md, decisions 6, 10 and 11, P8, Interfaces §C): a terminal's text goes into the chat of the terminal's own
// session as one pasted block, never sent by itself (composer/attach-pasted.ts hands it over), and the outcome is said
// in one line (`ATTACH`). What is attached: the selection as the terminal gives it, unchanged; with nothing selected,
// from the chord only, what the screen shows (`screenText`). The selection is never cleared, added or not.
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { attachPasted, type AttachOutcome } from '../../composer/attach-pasted';
import { ipc } from '../../ipc/client';
import { registerAction } from '../../keymap/actions-runtime';
import { displayTitle } from '../../sessions/title';
import { useMachines } from '../../stores/machines';
import { toast } from '../../stores/notices';
import { machineName } from '../../stores/org-projects';
import { useSessions } from '../../stores/sessions';
import { terminals, type TerminalId } from '../../terminal/registry';
import { ATTACH } from './copy';

const line = (level: 'info' | 'warning', text: string) => void toast({ level, text, actions: [], dismissible: true });

function say(appSessionId: AppSessionId, outcome: AttachOutcome): void {
  if (outcome.kind === 'taken') return; // the box on screen has it, and the keyboard
  const local = ipc.localMachine;
  const machine = isAddress(appSessionId) && machineOf(appSessionId) !== local ? machineName(useMachines.getState().machines, machineOf(appSessionId), local) : null;
  const words = { title: displayTitle(useSessions.getState().records.get(appSessionId)), machine };
  if (outcome.kind === 'added') line('info', ATTACH.added(words));
  else if (outcome.kind === 'unconfirmed') line('warning', ATTACH.unconfirmed(words));
  else line('warning', ATTACH.refused[outcome.why](words));
}

/** The terminal's text into its session's chat, and the outcome said. `menu`: the terminal's own menu, which offers it
 * only with a selection; `chord`: ⇧⌘L or Edit ▸ Attach selection to chat, which reads the screen when nothing is
 * selected. */
export async function attachFromTerminal(id: TerminalId, source: 'menu' | 'chord'): Promise<void> {
  const handle = terminals.get(id);
  const renderer = handle?.renderer ?? null;
  if (!handle || renderer === null) return;
  const selected = renderer.hasSelection() ? renderer.getSelection() : '';
  const text = selected !== '' ? selected : source === 'chord' ? renderer.screenText() : '';
  if (text.trim() === '') {
    line('warning', ATTACH.nothing);
    return;
  }
  const appSessionId = handle.info.appSessionId;
  say(appSessionId, await attachPasted(appSessionId, text));
}

/**
 * The action's handler follows the keyboard (P8): registered while a terminal holds it, so the menu's item, the chord
 * and the palette have it only there. A focus that leaves is read once the page has moved it (the focused element in a
 * `focusout` is not yet the new one); a window that loses the keyboard to its own menu bar keeps it where it was.
 */
export function connectTerminalAttach(): () => void {
  let holder: TerminalId | null = null;
  let off: (() => void) | null = null;
  const sync = () => {
    const id = terminals.focused()?.info.id ?? null;
    if (id === holder) return;
    off?.();
    off = null;
    holder = id;
    if (id !== null) off = registerAction('terminal.attachSelection', () => attachFromTerminal(id, 'chord'));
  };
  let pending = false;
  const later = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      sync();
    });
  };
  window.addEventListener('focusin', sync);
  window.addEventListener('focusout', later);
  sync();
  return () => {
    window.removeEventListener('focusin', sync);
    window.removeEventListener('focusout', later);
    off?.();
    off = null;
    holder = null;
  };
}

// The terminal keeps ordinary input and its copy/paste/select-all chords. Effective application menu bindings yield
// to the shell, even without ⌘ (F6's region navigation, or a function-key override). The effective tab-cycle bindings
// (⌃Tab / ⌃⇧Tab by default) are forwarded explicitly, because the pane dispatcher leaves terminal-owned keys alone.
// The registry installs it on every renderer and forwards the two tab verdicts through C5's `runAction`.
import { ACTIONS, ACTION_IDS, effectiveChord, type KeymapOverrides } from '@shared/keymap/actions';
import { matchesChord, parseChord } from '@shared/keymap/chord';

const MENU_ACTIONS = ACTION_IDS.filter((id) => ACTIONS[id].sink === 'menu');

export type KeyVerdict = 'pty' | 'app' | 'tab.next' | 'tab.previous';

const TERMINAL_COMMAND_CHORDS = new Set(['c', 'v', 'a']);

// The chord's letter: the character when the layout produces a Latin one, else the key's position, so ⌘C still copies
// under a non-Latin layout (Korean 2-set reports `ㅊ` for the C key).
function chordLetter(ev: KeyboardEvent): string {
  if (/^[a-z]$/i.test(ev.key)) return ev.key.toLowerCase();
  return ev.code.startsWith('Key') ? ev.code.slice(3).toLowerCase() : '';
}

export function terminalKeyFilter(ev: KeyboardEvent, keymap: KeymapOverrides = {}): KeyVerdict {
  if (ev.metaKey && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && TERMINAL_COMMAND_CHORDS.has(chordLetter(ev))) return 'pty';
  for (const id of ['tab.next', 'tab.previous'] as const) {
    const chord = effectiveChord(id, keymap);
    if (chord !== null && matchesChord(ev, parseChord(chord))) return id;
  }
  if (ev.metaKey) return 'app';
  const bound = MENU_ACTIONS.some((id) => {
    const chord = effectiveChord(id, keymap);
    if (chord === null) return false;
    const chords = id === 'tab.select' && chord.endsWith('1')
      ? Array.from({ length: 9 }, (_, i) => `${chord.slice(0, -1)}${i + 1}`) : [chord];
    return chords.some((accelerator) => matchesChord(ev, parseChord(accelerator)));
  });
  return bound ? 'app' : 'pty';
}

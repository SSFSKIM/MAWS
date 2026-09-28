// The terminal's key filter (Residue *Keyboard*, the §5.7 focused-pane rule applied to a terminal): with a terminal
// focused, every key without ⌘ goes to the pty, except ⌃Tab and ⌃⇧Tab, which stay the app's tab cycle; every ⌘ chord
// goes to the app, except ⌘C, ⌘V and ⌘A, which the terminal handles (copy the selection, paste, select all).
// The registry installs it on every renderer and forwards the two tab verdicts through C5's `runAction`.

export type KeyVerdict = 'pty' | 'app' | 'tab.next' | 'tab.previous';

const TERMINAL_COMMAND_CHORDS = new Set(['c', 'v', 'a']);

// The chord's letter: the character when the layout produces a Latin one, else the key's position, so ⌘C still copies
// under a non-Latin layout (Korean 2-set reports `ㅊ` for the C key).
function chordLetter(ev: KeyboardEvent): string {
  if (/^[a-z]$/i.test(ev.key)) return ev.key.toLowerCase();
  return ev.code.startsWith('Key') ? ev.code.slice(3).toLowerCase() : '';
}

export function terminalKeyFilter(ev: KeyboardEvent): KeyVerdict {
  if (ev.ctrlKey && !ev.metaKey && ev.key === 'Tab') return ev.shiftKey ? 'tab.previous' : 'tab.next';
  if (ev.metaKey) {
    const plain = !ev.shiftKey && !ev.altKey && !ev.ctrlKey;
    return plain && TERMINAL_COMMAND_CHORDS.has(chordLetter(ev)) ? 'pty' : 'app';
  }
  return 'pty';
}

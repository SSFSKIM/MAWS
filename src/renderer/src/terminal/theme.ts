// The terminal's colours come from X7 tokens (Residue *Fonts and palette*): the 21 `--term-*` names in
// `styles/tokens.css`, read as computed values at runtime and rebuilt on every theme change, so no component and no
// adapter ever holds a colour literal. `read` is injected so tests need no DOM; production passes
// `getComputedStyle(document.documentElement).getPropertyValue`.
import type { TerminalTheme } from './renderer';

export const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

const BASE_TOKENS = {
  background: '--term-bg',
  foreground: '--term-fg',
  cursor: '--term-cursor',
  cursorAccent: '--term-cursor-fg',
  selectionBackground: '--term-selection',
} as const;

const ANSI_TOKENS = [
  ...ANSI_NAMES.map((name) => `--term-ansi-${name}`),
  ...ANSI_NAMES.map((name) => `--term-ansi-bright-${name}`),
];

export const TERMINAL_TOKEN_NAMES: readonly string[] = [...Object.values(BASE_TOKENS), ...ANSI_TOKENS];

export function readTerminalTheme(read: (name: string) => string): TerminalTheme {
  // A missing token is a bug in tokens.css, not a reason to draw a black terminal.
  const value = (name: string) => {
    const v = read(name).trim();
    if (!v) throw new Error(`terminal token ${name} has no value`);
    return v;
  };
  return {
    background: value(BASE_TOKENS.background),
    foreground: value(BASE_TOKENS.foreground),
    cursor: value(BASE_TOKENS.cursor),
    cursorAccent: value(BASE_TOKENS.cursorAccent),
    selectionBackground: value(BASE_TOKENS.selectionBackground),
    ansi: ANSI_TOKENS.map(value),
  };
}

export function readDocumentTheme(): TerminalTheme {
  const style = getComputedStyle(document.documentElement);
  return readTerminalTheme((name) => style.getPropertyValue(name));
}

import { describe, expect, it } from 'vitest';
import { ANSI_NAMES, readTerminalTheme, TERMINAL_TOKEN_NAMES } from './theme';

const values: Record<string, string> = {
  '--term-bg': 'white',
  '--term-fg': 'black',
  '--term-cursor': 'orange',
  '--term-cursor-fg': 'white',
  '--term-selection': 'sel',
};
for (const name of ANSI_NAMES) {
  values[`--term-ansi-${name}`] = `c-${name}`;
  values[`--term-ansi-bright-${name}`] = `c-bright-${name}`;
}

describe('terminal theme from tokens', () => {
  it('maps the 21 --term-* tokens onto the renderer theme in ANSI order', () => {
    const theme = readTerminalTheme((name) => ` ${values[name] ?? ''} `);
    expect(theme).toEqual({
      background: 'white',
      foreground: 'black',
      cursor: 'orange',
      cursorAccent: 'white',
      selectionBackground: 'sel',
      ansi: [
        'c-black', 'c-red', 'c-green', 'c-yellow', 'c-blue', 'c-magenta', 'c-cyan', 'c-white',
        'c-bright-black', 'c-bright-red', 'c-bright-green', 'c-bright-yellow', 'c-bright-blue', 'c-bright-magenta', 'c-bright-cyan', 'c-bright-white',
      ],
    });
    expect(TERMINAL_TOKEN_NAMES).toHaveLength(21);
  });

  it('throws naming the token when a value is missing', () => {
    expect(() => readTerminalTheme((name) => (name === '--term-ansi-bright-cyan' ? '' : values[name] ?? 'x'))).toThrow(
      '--term-ansi-bright-cyan',
    );
  });
});

// `appearance.monoFont` as the document-root `--font-mono` override (C11 execution document, Appearance row; ruled
// 2026-09-29): the family first, then the token stack, which the terminal and code blocks already read.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import { createSettingsStore } from '../stores/settings';
import { applyMonoFont, connectMonoFont, monoFontStack, TOKEN_MONO_STACK } from './mono-font';

const root = document.documentElement;
afterEach(() => root.style.removeProperty('--font-mono'));

describe('the monospace font override', () => {
  it("keeps tokens.css's stack after the family", () => {
    const tokens = readFileSync(join(__dirname, '../styles/tokens.css'), 'utf8');
    const declared = [...tokens.matchAll(/--font-mono:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared)).toEqual(new Set([TOKEN_MONO_STACK]));
  });

  it('quotes the family, escapes what a CSS string cannot hold, and drops quotes the user typed', () => {
    expect(monoFontStack('MesloLGM Nerd Font Mono')).toBe(`"MesloLGM Nerd Font Mono", ${TOKEN_MONO_STACK}`);
    expect(monoFontStack('  "Symbols Nerd Font Mono"  ')).toBe(`"Symbols Nerd Font Mono", ${TOKEN_MONO_STACK}`);
    expect(monoFontStack('a"b\\c')).toBe(`"a\\"b\\\\c", ${TOKEN_MONO_STACK}`);
    expect(monoFontStack(null)).toBeNull();
    expect(monoFontStack('   ')).toBeNull();
  });

  it('sets the root property, and removes it for null so the token applies again', () => {
    applyMonoFont('MesloLGM Nerd Font Mono', root);
    expect(root.style.getPropertyValue('--font-mono')).toBe(`"MesloLGM Nerd Font Mono", ${TOKEN_MONO_STACK}`);
    applyMonoFont(null, root);
    expect(root.style.getPropertyValue('--font-mono')).toBe('');
  });

  it('follows the settings store', () => {
    const settings = createSettingsStore({ invoke: async () => ({ ok: false }), on: () => () => {} } as never);
    const state = (monoFont: string | null) => ({ settings: { ...SETTINGS_DEFAULTS_V14, appearance: { ...SETTINGS_DEFAULTS_V14.appearance, monoFont } }, resolvedTheme: 'light' as const });
    const off = connectMonoFont(settings, root);
    expect(root.style.getPropertyValue('--font-mono')).toBe('');
    settings.setState({ state: state('Symbols Nerd Font Mono') });
    expect(root.style.getPropertyValue('--font-mono')).toBe(`"Symbols Nerd Font Mono", ${TOKEN_MONO_STACK}`);
    settings.setState({ state: state(null) });
    expect(root.style.getPropertyValue('--font-mono')).toBe('');
    off();
    settings.setState({ state: state('Other') });
    expect(root.style.getPropertyValue('--font-mono')).toBe('');
  });
});

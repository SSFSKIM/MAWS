// `appearance.transcriptWidth` as the document-root `--measure` (W2; charter §6 as amended 2026-10-01): the token is the
// default, and the wider two override it on the root, where the transcript's rows and the composer frame both read it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TranscriptWidth } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V5 } from '@shared/settings/defaults';
import { createSettingsStore } from '../stores/settings';
import { applyTranscriptWidth, connectTranscriptWidth, DEFAULT_TRANSCRIPT_WIDTH } from './transcript-width';

const root = document.documentElement;
afterEach(() => root.style.removeProperty('--measure'));

describe('the transcript width', () => {
  it("defaults to tokens.css's --measure", () => {
    const tokens = readFileSync(join(__dirname, '../styles/tokens.css'), 'utf8');
    expect([...tokens.matchAll(/--measure:\s*([^;]+);/g)].map((m) => m[1]!.trim())).toEqual([`${DEFAULT_TRANSCRIPT_WIDTH}px`]);
    expect(SETTINGS_DEFAULTS_V5.appearance.transcriptWidth).toBe(DEFAULT_TRANSCRIPT_WIDTH);
  });

  it('follows the settings store, leaving the token alone at the default', () => {
    const settings = createSettingsStore({ invoke: async () => ({ ok: false }), on: () => () => {} } as never);
    const state = (transcriptWidth: TranscriptWidth) => ({ settings: { ...SETTINGS_DEFAULTS_V5, appearance: { ...SETTINGS_DEFAULTS_V5.appearance, transcriptWidth } }, resolvedTheme: 'light' as const });
    const off = connectTranscriptWidth(settings, root);
    expect(root.style.getPropertyValue('--measure')).toBe('');
    settings.setState({ state: state(1280) });
    expect(root.style.getPropertyValue('--measure')).toBe('1280px');
    settings.setState({ state: state(960) });
    expect(root.style.getPropertyValue('--measure')).toBe('960px');
    settings.setState({ state: state(768) });
    expect(root.style.getPropertyValue('--measure')).toBe('');
    off();
    applyTranscriptWidth(960, root);
    settings.setState({ state: state(1280) });
    expect(root.style.getPropertyValue('--measure')).toBe('960px'); // disconnected
  });
});

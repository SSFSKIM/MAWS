// A bridge for the Settings tab's tests (C11 M5): `settings.set` goes through the real merge and the command validator, lands in
// the settings store as main's `settings.changed` would, and is logged; the reads the sections make are answered from
// small literals a test may replace.
import { vi } from 'vitest';
import { validateCommandInput } from '@shared/ipc/validate';
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import type { Custody } from '@shared/ipc/schema/settings'; // C12
import type { CommandName, MawsBridge, Settings, SettingsPatch } from '@shared/ipc/schema';
import { applySettingsPatch, SETTINGS_DEFAULTS_V7 } from '@shared/settings/defaults';
import { useSettings } from '../stores/settings';

export const BINARY: BinaryInfo = { path: '/Users/owner/.local/share/claude/versions/2.1.283', testedVersion: '2.1.283', version: '2.1.283', ok: true, error: null };
// C12 start: MAWS's copy of the pinned engine, as main's `settings.engineCustody` answers it
export const CUSTODY: Custody = {
  state: 'ok',
  path: '/Users/owner/Library/Application Support/MAWS/engine/2.1.283/claude',
  manifest: { version: '2.1.283', sha256: 'd8cb1e5c79684cc12a8bfc813e3a2073406921b6245744b3009be3ab5651d21e', size: 225036032, source: '/Users/owner/.local/share/claude/versions/2.1.283', copiedAt: '2026-09-29T12:00:00.000Z' },
};
// C12 end

export interface SettingsBridge {
  bridge: MawsBridge;
  sets: SettingsPatch[];
  calls: { name: string; input: unknown }[];
  answers: Record<string, (input: unknown) => unknown>; // command → the value it answers (throw to answer an error)
}

export function settingsBridge(initial: Settings = SETTINGS_DEFAULTS_V7): SettingsBridge {
  let settings = structuredClone(initial);
  const publish = () => useSettings.setState({ state: { settings, resolvedTheme: settings.theme === 'dark' ? 'dark' : 'light' } });
  publish();
  const sets: SettingsPatch[] = [];
  const calls: { name: string; input: unknown }[] = [];
  const answers: SettingsBridge['answers'] = {
    'engine.binaryInfo': () => BINARY,
    // C12 start: main is the only sender of engine.configure; the tab awaits main's push and re-reads the binary
    'settings.engineApplied': () => undefined,
    'settings.engineCustody': () => CUSTODY,
    // C12 end
    'fs.state': () => ({ configHome: '/Users/owner/.claude', watching: true, projects: 0, sessions: 0, bound: 0, followed: [], holders: [], lastScanAt: null, lastScan: null }),
    'engine.models': () => ({
      models: [
        { value: 'default', displayName: 'Default (recommended)' },
        { value: 'sonnet', displayName: 'Sonnet 5' },
        { value: 'haiku', displayName: 'Haiku' },
        { value: 'claude/astra', displayName: 'astra' },
      ],
      source: 'cached',
      at: null,
    }),
    'engine.relayHealth': () => ({ url: 'http://127.0.0.1:8641', ok: true, status: 200, latencyMs: 2, checkedAt: new Date().toISOString(), error: null }),
    'layout.pickFiles': () => ({ files: [] }),
    'layout.captureChords': () => undefined,
  };
  const bridge = {
    invoke: vi.fn(async (name: string, input: unknown) => {
      calls.push({ name, input });
      const checked = validateCommandInput(name as CommandName, input);
      if (!checked.ok) return checked;
      if (name === 'settings.set') {
        sets.push(input as SettingsPatch);
        settings = applySettingsPatch(settings, input as SettingsPatch);
        publish();
        return { ok: true, value: { settings, resolvedTheme: 'light' } };
      }
      const answer = answers[name];
      if (!answer) return { ok: false, error: { code: 'internal', message: `no answer for ${name}` } };
      try {
        return { ok: true, value: answer(input) };
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: (error as Error).message } };
      }
    }),
    on: () => () => {},
    pathForFile: () => '',
  } as unknown as MawsBridge;
  return { bridge, sets, calls, answers };
}

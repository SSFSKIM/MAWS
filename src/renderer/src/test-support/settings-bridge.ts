// A bridge for the Settings tab's tests (C11 M5): `settings.set` goes through the real merge and the command validator, lands in
// the settings store as main's `settings.changed` would, and is logged; the reads the sections make are answered from
// small literals a test may replace.
import { vi } from 'vitest';
import { validateCommandInput } from '@shared/ipc/validate';
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import type { CommandName, MawsBridge, Settings, SettingsPatch } from '@shared/ipc/schema';
import { applySettingsPatch, SETTINGS_DEFAULTS_V13 } from '@shared/settings/defaults';
import { useSettings } from '../stores/settings';

export const BINARY: BinaryInfo = { path: '/Users/owner/.local/share/claude/versions/2.1.287', testedVersion: '2.1.283', version: '2.1.287', ok: true, error: null }; // W13: the installed one

export const VOICE_HELPER = '/Applications/MAWS.app/Contents/Resources/voice-helper/maws-voice-helper'; // E9

export interface SettingsBridge {
  bridge: MawsBridge;
  sets: SettingsPatch[];
  calls: { name: string; input: unknown }[];
  answers: Record<string, (input: unknown) => unknown>; // command → the value it answers (throw to answer an error)
}

export function settingsBridge(initial: Settings = SETTINGS_DEFAULTS_V13): SettingsBridge {
  let settings = structuredClone(initial);
  const publish = () => useSettings.setState({ state: { settings, resolvedTheme: settings.theme === 'dark' ? 'dark' : 'light' } });
  publish();
  const sets: SettingsPatch[] = [];
  const calls: { name: string; input: unknown }[] = [];
  const answers: SettingsBridge['answers'] = {
    'engine.binaryInfo': () => BINARY,
    // C12 start: main is the only sender of engine.configure; the tab awaits main's push and re-reads the binary
    'settings.engineApplied': () => undefined,
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
    // E9 start: Settings › Voice's probe (never prompts) and the denial rows' System Settings button
    'voice.status': (input) => ({
      helper: { state: 'ready', path: VOICE_HELPER },
      backend: 'helper',
      permission: { microphone: 'authorized', speech: 'authorized' },
      systemLocale: 'ko-KR',
      locale: (input as { locale: string | null }).locale ?? 'ko-KR',
      supportsOnDevice: true,
      locales: ['ko-KR', 'en-US', 'fr-FR'],
    }),
    'voice.openPrivacySettings': () => undefined,
    // E9 end
    // E10 start: Settings › Engine › Background supervisor connects the hosts store (the engine host in the app, as under
    // the harness); a test replaces these to show a detached supervisor
    'engine.hostState': () => ({ state: 'ready', pid: 1111, restarts: 0, revision: 1 }),
    'pty.hostState': () => ({ state: 'ready', pid: 2222, restarts: 0, revision: 1 }),
    'host.status': () => ({ transport: 'utility', state: 'ready', supervisor: null, appBuildId: 'b', appWire: 'w', mainBuild: { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' }, matches: null, reason: null, waitingLiveSessions: null, lastExit: null }),
    'host.restart': () => undefined,
    // E10 end
    // E4a start: Settings › Browser's profile select (E4b writes the profiles; none by default)
    'browser.profiles.list': () => ({ profiles: [] }),
    // E4a end
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

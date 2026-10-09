// The import sheet's and Settings › Browser's suites (E4b, M3): the Settings bridge (its `settings.set` through the real
// merge) with main's events delivered on demand, and the answers main gives over the synthetic Chrome profile of
// `test/support/chrome-profile.ts`: its two profiles, the inspection of `Default` (four extension candidates) and the
// record of a done import.
import type { ExtensionCandidate } from '@shared/browser/import';
import type { ImportedProfile } from '@shared/browser/profiles';
import type { BrowserImportInspection } from '@shared/ipc/schema/browser';
import type { EventName, EventPayload, MawsBridge, Settings } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';
import { DONE_REPORT } from '../../../../test/support/import-reports';
import { settingsBridge, type SettingsBridge } from './settings-bridge';

export const CHROME = '/Users/owner/Library/Application Support/Google/Chrome';
export const INSPECTION_ID = '11111111-1111-4111-8111-111111111111';
export const IMPORT_ID = '22222222-2222-4222-8222-222222222222';
export const OTHER_IMPORT_ID = '33333333-3333-4333-8333-333333333333';

export const PROBE_ID = 'cddgipniephaglaopjjeihjehogcpggh';
export const FAILS_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const WALLET_ID = 'cccccccccccccccccccccccccccccccc';
export const DISABLED_ID = 'dddddddddddddddddddddddddddddddd';

export const PROFILES_ANSWER = {
  userDataDir: CHROME,
  found: true,
  chromeRunning: false,
  error: null,
  profiles: [
    { profileDir: 'Default', name: 'Person 1', gaiaName: 'Probe Owner', userName: 'probe@example.test', lastUsed: true, imported: false },
    { profileDir: 'Profile 1', name: 'Work', gaiaName: null, userName: null, lastUsed: false, imported: false },
  ],
};

const candidate = (over: Partial<ExtensionCandidate> & Pick<ExtensionCandidate, 'id' | 'name'>): ExtensionCandidate => ({
  version: '1.0',
  manifestVersion: 3,
  background: 'service_worker',
  contentScripts: 0,
  unsupportedPermissions: [],
  wallet: false,
  chromeState: 'enabled',
  sizeBytes: 4096,
  error: null,
  ...over,
});

export const INSPECTION: BrowserImportInspection = {
  inspectionId: INSPECTION_ID,
  profile: PROFILES_ANSWER.profiles[0]!,
  chromeRunning: false,
  history: { rows: 6 },
  cookies: { rows: 5, partitioned: 1, storeVersion: 24 },
  extensions: [
    candidate({ id: PROBE_ID, name: 'Probe', contentScripts: 1, unsupportedPermissions: ['cookies', 'webNavigation', 'contextMenus', 'notifications', 'sidePanel'] }),
    candidate({ id: FAILS_ID, name: 'Fails', unsupportedPermissions: ['contextMenus'] }),
    candidate({ id: WALLET_ID, name: 'Probe Wallet', background: 'none', wallet: true }),
    candidate({ id: DISABLED_ID, name: 'Disabled in Chrome', chromeState: 'disabled' }),
  ],
  bookmarks: { count: 46 }, // cua #90
};

export const DONE = DONE_REPORT;

export const RECORD: ImportedProfile = {
  profileDir: 'Default',
  name: 'Person 1',
  partition: 'persist:maws-chrome-Default',
  importedAt: '2026-10-06T10:00:05.000Z',
  storageDirName: 'maws-chrome-default',
  userDataDir: CHROME,
  extensions: DONE.extensions,
  report: DONE,
  bookmarks: null, // cua #90: profiles.json version 2
  gaiaName: null,
  userName: null,
  avatar: { kind: 'initials' },
};

export interface ImportBridge extends SettingsBridge {
  emit<N extends EventName>(name: N, payload: EventPayload<N>): void;
}

// Main's answers for the import's commands, each replaceable by a case; events reach the listeners only when they pass
// the event's schema, as the real client checks them.
export function importBridge(initial: Settings = SETTINGS_DEFAULTS_V11): ImportBridge {
  const b = settingsBridge(initial);
  Object.assign(b.answers, {
    'browser.import.list': () => ({ profiles: [], fileBroken: false, running: null }),
    'browser.import.profiles': (input: { userDataDir: string | null }) => (input.userDataDir === null ? PROFILES_ANSWER : { ...PROFILES_ANSWER, userDataDir: input.userDataDir }),
    'browser.import.chooseUserData': () => ({ userDataDir: null }),
    'browser.import.inspect': () => INSPECTION,
    'browser.import.discard': () => undefined,
    'browser.import.start': () => ({ importId: IMPORT_ID }),
    'browser.import.cancel': () => undefined,
  });
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const bridge = {
    ...b.bridge,
    on: (name: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => void listeners.get(name)!.delete(listener);
    },
  } as MawsBridge;
  const emit: ImportBridge['emit'] = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name} in a test: ${JSON.stringify(checked.issues)}`);
    for (const listener of listeners.get(name) ?? []) listener(checked.value);
  };
  return { ...b, bridge, emit };
}

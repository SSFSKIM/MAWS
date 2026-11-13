// U11a M9 (l8-settings-06; the execution document's Interfaces §G, consumed by M10's search and U7's dialog): every row
// of Settings outside the Org page, declared once, in the page's order. A drawn row names its declaration and the state
// it shows (`<Setting row="engine.binary" state="chosen">`, parts.tsx) and tells the view both (drawn.ts), so the search
// knows what the page shows now. A row made at run time is declared once with `repeats` (an imported Chrome profile, one
// of its extensions) and drawn under its own name. A {name} in a state's words is a value the drawn row fills in.
import type { SettingsSection } from './SettingsView';
import { APPEARANCE, ARTIFACTS, BROWSER, BUDGET_SETTINGS, ENGINE, GATEWAY, KEYBOARD, LAUNCH_PROFILE, MCP_SERVERS, NOTIFICATIONS, SESSIONS, SUPERVISOR, VOICE } from './copy';
import { USAGE } from '../accounts/copy'; // UX wave U7b (O-47)

export interface SettingsRow {
  id: string; // '<section>.<row>': the search's result and the row's mark in the page (data-settings-row)
  section: SettingsSection;
  label: string;
  states: Readonly<Record<string, { line?: string; more?: string; state?: true }>>; // most rows have one, 'default'; `state`: the line reports a condition the person must act on
  keywords?: readonly string[]; // other words people use
  revealedBy?: string; // the row whose control makes this one drawn
  repeats?: true; // drawn once per thing made at run time
}

const NO_NOTE = { default: {} } as const;
const GATEWAY_WORDS = ['relay', 'account', 'direct'] as const;

export const SETTINGS_ROWS: readonly SettingsRow[] = [
  { id: 'appearance.theme', section: 'appearance', label: APPEARANCE.theme, states: NO_NOTE, keywords: ['dark', 'light'] },
  { id: 'appearance.transcriptWidth', section: 'appearance', label: APPEARANCE.transcriptWidth, states: APPEARANCE.transcriptWidthNotes },
  { id: 'appearance.monoFont', section: 'appearance', label: APPEARANCE.monoFont, states: APPEARANCE.monoFontNotes },

  { id: 'notifications.toHuman', section: 'notifications', label: NOTIFICATIONS.toHuman.label, states: NOTIFICATIONS.toHuman.notes },
  { id: 'notifications.when', section: 'notifications', label: NOTIFICATIONS.when, states: NO_NOTE },
  { id: 'notifications.kinds', section: 'notifications', label: NOTIFICATIONS.kinds, states: NO_NOTE },
  { id: 'notifications.sound', section: 'notifications', label: NOTIFICATIONS.sound, states: NO_NOTE },

  { id: 'keyboard.bindings', section: 'keyboard', label: KEYBOARD.table, states: NO_NOTE, keywords: ['shortcut', 'hotkey'] },
  { id: 'keyboard.reset', section: 'keyboard', label: KEYBOARD.reset, states: NO_NOTE },

  { id: 'voice.shortcut', section: 'voice', label: VOICE.shortcut, states: VOICE.shortcutNotes },
  { id: 'voice.language', section: 'voice', label: VOICE.language, states: VOICE.languageNotes },
  { id: 'voice.helper', section: 'voice', label: VOICE.helper, states: VOICE.helperNotes },
  { id: 'voice.microphone', section: 'voice', label: VOICE.microphone, states: NO_NOTE },
  { id: 'voice.speech', section: 'voice', label: VOICE.speech, states: NO_NOTE },
  { id: 'voice.recognition', section: 'voice', label: VOICE.recognition, states: NO_NOTE },

  { id: 'browser.profile', section: 'browser', label: BROWSER.profile, states: BROWSER.profileNotes },
  { id: 'browser.bookmarksBar', section: 'browser', label: BROWSER.bookmarksBar, states: BROWSER.bookmarksBarNotes },
  { id: 'browser.search', section: 'browser', label: BROWSER.search, states: BROWSER.searchNotes },
  { id: 'browser.links', section: 'browser', label: BROWSER.links, states: BROWSER.linksNotes },
  { id: 'browser.chromeProfile', section: 'browser', label: BROWSER.chromeProfile, states: BROWSER.chromeProfileNotes },
  { id: 'browser.importedProfile', section: 'browser', label: BROWSER.importedProfile, states: BROWSER.importedProfileNotes, revealedBy: 'browser.chromeProfile', repeats: true },
  { id: 'browser.extension', section: 'browser', label: BROWSER.extensions, states: BROWSER.extensionNotes, revealedBy: 'browser.chromeProfile', repeats: true },

  { id: 'artifacts.exportAuthor', section: 'artifacts', label: ARTIFACTS.exportAuthorName, states: ARTIFACTS.exportAuthorNotes },
  { id: 'artifacts.defaultSystem', section: 'artifacts', label: ARTIFACTS.defaultSystem, states: ARTIFACTS.defaultSystemNotes },
  { id: 'artifacts.bySpace', section: 'artifacts', label: ARTIFACTS.bySpace, states: ARTIFACTS.bySpaceNotes },

  { id: 'sessions.plugins', section: 'sessions', label: LAUNCH_PROFILE.plugins, states: LAUNCH_PROFILE.pluginsNotes },
  { id: 'sessions.hooks', section: 'sessions', label: LAUNCH_PROFILE.hooks, states: LAUNCH_PROFILE.hooksNotes },
  { id: 'sessions.mcpServers', section: 'sessions', label: MCP_SERVERS.label, states: MCP_SERVERS.notes, keywords: ['connectors', 'integrations', 'tools'] },
  { id: 'sessions.subagent', section: 'sessions', label: SESSIONS.subagent, states: SESSIONS.subagentNotes },
  { id: 'sessions.autoFallback', section: 'sessions', label: SESSIONS.autoFallback, states: SESSIONS.autoFallbackNotes },
  { id: 'sessions.archive', section: 'sessions', label: SESSIONS.archive, states: SESSIONS.archiveNotes },

  { id: 'gateway.defaultRoute', section: 'gateway', label: GATEWAY.defaultRoute, states: GATEWAY.defaultRouteNotes, keywords: GATEWAY_WORDS },
  { id: 'gateway.policy', section: 'gateway', label: GATEWAY.policy, states: GATEWAY.policyNotes, keywords: GATEWAY_WORDS },
  { id: 'gateway.offerDirect', section: 'gateway', label: GATEWAY.offerDirect, states: GATEWAY.offerDirectNotes, keywords: GATEWAY_WORDS },
  { id: 'gateway.directLogin', section: 'gateway', label: GATEWAY.directLogin, states: GATEWAY.directLoginNotes, keywords: GATEWAY_WORDS },
  { id: 'gateway.relay', section: 'gateway', label: GATEWAY.relay, states: NO_NOTE, keywords: GATEWAY_WORDS },

  // UX wave U7b (O-47): the usage panel, one row; its account cards are not rows (UsageSection.tsx)
  { id: 'usage.accounts', section: 'usage', label: USAGE.claudeTitle, states: NO_NOTE, keywords: ['limit', 'account', 'route', 'codex'] },

  { id: 'engine.binary', section: 'engine', label: ENGINE.binary, states: ENGINE.binaryNotes },
  { id: 'engine.update', section: 'engine', label: ENGINE.update, states: ENGINE.updateNotes },
  { id: 'engine.configHome', section: 'engine', label: ENGINE.configHome, states: ENGINE.configHomeNotes },

  { id: 'supervisor.status', section: 'supervisor', label: SUPERVISOR.status, states: SUPERVISOR.statusNotes },
  { id: 'supervisor.daemon', section: 'supervisor', label: SUPERVISOR.daemon, states: NO_NOTE },
  { id: 'supervisor.idleExit', section: 'supervisor', label: SUPERVISOR.idle, states: SUPERVISOR.idleNotes },
  { id: 'supervisor.stopAll', section: 'supervisor', label: SUPERVISOR.stopAll, states: SUPERVISOR.stopAllNotes },
  { id: 'supervisor.memoryBudget', section: 'supervisor', label: BUDGET_SETTINGS.enabled, states: BUDGET_SETTINGS.enabledNotes, keywords: ['RAM'] },
  { id: 'supervisor.limit', section: 'supervisor', label: BUDGET_SETTINGS.limit, states: BUDGET_SETTINGS.limitNotes, keywords: ['RAM'], revealedBy: 'supervisor.memoryBudget' },
  { id: 'supervisor.stateful', section: 'supervisor', label: BUDGET_SETTINGS.stateful, states: BUDGET_SETTINGS.statefulNotes, revealedBy: 'supervisor.memoryBudget' },
];

const BY_ID = new Map(SETTINGS_ROWS.map((row) => [row.id, row]));

// A drawn row's declaration. A row drawn under a name the table does not hold is a fault of this file's or its caller's.
export function settingsRow(id: string): SettingsRow {
  const row = BY_ID.get(id);
  if (row === undefined) throw new Error(`Settings row ${id} is not declared in SETTINGS_ROWS`);
  return row;
}

// A state's words with each {name} filled in; a value not known yet reads as an ellipsis.
export const fillPlaces = (words: string, values: Readonly<Record<string, string | null>> = {}): string => words.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '…');

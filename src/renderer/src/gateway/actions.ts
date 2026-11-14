// C11's handlers in C5's action table (C11 execution document, Keymap and action entries): Settings… (⌘,) opens Settings
// (UX wave U7b: the dialog over the window, `openSettings`; open already, it stays open), and Open ClaudeUsage hands the
// user to ClaudeUsage's panel with the instruction as a toast. The ⌘K palette lists both from the table; C10's relay card
// runs the hand-off. (W6: the Accounts tab retired; its action, Usage, opens the top bar's usage popover and is
// registered by `../usage`.)
import type { ClaudeUsageOpenIntent, ClaudeUsageOpenResult, MawsBridge } from '@shared/ipc/schema';
import { ACCOUNTS, CLAUDE_USAGE_README_URL } from '../accounts/copy';
import { ipc } from '../ipc/client';
import { registerAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import type { SettingsSection } from '../settings-tab/SettingsView'; // UX wave U7b: a type only, so no view loads with the action

// settings.open's numeric arg names a section by its place in this list, the Settings index's order when the numbers were
// given (U11a M9: the index's order is SECTION_TABLE's now, and this list stays as callers know it).
export const SETTINGS_SECTIONS = ['engine', 'gateway', 'keyboard', 'appearance', 'notifications'] as const satisfies readonly SettingsSection[];

// The instruction names a control in ClaudeUsage's panel, so it stays long enough to read and act on (M4 decisions).
export const HAND_OFF_TOAST_MS = 8000;

// The one hand-off call (the action here, the usage popover's Open ClaudeUsage): activates ClaudeUsage and shows the
// instruction naming the control in its panel; when ClaudeUsage is not installed the toast carries `Install ClaudeUsage`,
// which opens its README (the architect's ruling of 2026-09-29: the relay card's `not_installed` is covered here, and
// C10's card is left alone). Answers null, with a warning toast, when main refused the call.
export async function openClaudeUsage(intent: ClaudeUsageOpenIntent, client: MawsBridge = ipc): Promise<ClaudeUsageOpenResult | null> {
  const result = await client.invoke('settings.claudeUsage.open', intent);
  if (!result.ok) {
    console.error('[gateway] settings.claudeUsage.open failed', result.error);
    toast({ level: 'warning', text: `ClaudeUsage could not be opened · ${result.error.message}`, actions: [], dismissible: true });
    return null;
  }
  const { opened, reason, instruction } = result.value;
  const install = { label: ACCOUNTS.install, run: () => void client.invoke('layout.openExternal', { url: CLAUDE_USAGE_README_URL }) };
  toast({ level: opened ? 'info' : 'warning', text: instruction, actions: reason === 'not_installed' ? [install] : [], dismissible: true, durationMs: HAND_OFF_TOAST_MS });
  return result.value;
}

export function registerGatewayActions(client: MawsBridge = ipc): () => void {
  const offs = [
    registerAction('settings.open', (arg) => useLayout.getState().openSettings(arg === null ? undefined : SETTINGS_SECTIONS[arg])),
    registerAction('gateway.openClaudeUsage', async () => void (await openClaudeUsage({ intent: 'panel' }, client))),
  ];
  return () => offs.forEach((off) => off());
}

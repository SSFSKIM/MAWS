// C11's handlers in C5's action table (C11 execution document, Keymap and action entries): Settings… (⌘,) and Accounts
// open their singleton tabs, and Open ClaudeUsage hands the user to ClaudeUsage's panel with the instruction as a toast.
// The ⌘K palette lists all three from the table; C10's relay card runs the hand-off.
import type { ClaudeUsageOpenIntent, ClaudeUsageOpenResult, MawsBridge } from '@shared/ipc/schema';
import type { TabTarget } from '@shared/ipc/schema/layout';
import { ACCOUNTS, CLAUDE_USAGE_README_URL } from '../accounts/copy';
import { ipc } from '../ipc/client';
import { registerAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';

type SettingsSection = Extract<TabTarget, { kind: 'settings' }>['section'];
// settings.open's numeric arg names a section by its place in the Settings tab's index.
export const SETTINGS_SECTIONS = ['engine', 'gateway', 'keyboard', 'appearance', 'notifications'] as const satisfies readonly NonNullable<SettingsSection>[];

// The instruction names a control in ClaudeUsage's panel, so it stays long enough to read and act on (M4 decisions).
export const HAND_OFF_TOAST_MS = 8000;

// The one hand-off call (the action here, the Accounts tab's four buttons in M5): activates ClaudeUsage and shows the
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
    registerAction('settings.open', (arg) => useLayout.getState().openTab({ kind: 'settings', section: arg === null ? null : (SETTINGS_SECTIONS[arg] ?? null) })),
    registerAction('accounts.open', () => useLayout.getState().openTab({ kind: 'accounts' })),
    registerAction('gateway.openClaudeUsage', async () => void (await openClaudeUsage({ intent: 'panel' }, client))),
  ];
  return () => offs.forEach((off) => off());
}

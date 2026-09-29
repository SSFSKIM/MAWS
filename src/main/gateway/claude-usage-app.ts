// ClaudeUsage, the app that owns the relay and its accounts (C11 execution document, Interfaces "X2 additions"; D-19):
// MAWS hands account actions to it and reports whether it is there. It registers no URL scheme, CLI or notification
// interface (its Info.plist has no CFBundleURLTypes), so a hand-off activates it by bundle id (`open -b`, which brings
// the menu-bar agent forward but does not open its popover) and answers the sentence the renderer shows as a toast,
// naming the control in its panel. The outcome is observed through the files ClaudeUsage rewrites (C7's reader).
import { execFile } from 'node:child_process';
import { CLAUDE_USAGE_BUNDLE_ID, type ClaudeUsageOpenIntent, type ClaudeUsageOpenResult, type ClaudeUsageStatus } from '@shared/ipc/schema';

export { CLAUDE_USAGE_BUNDLE_ID };
export const OPEN_TIMEOUT_MS = 5_000;
export const MDFIND_TIMEOUT_MS = 5_000;
export const INSTALLED_TTL_MS = 60_000;

export interface ClaudeUsageAppDeps {
  run(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string }>; // execFile; rejects with `code` and `stderr`
  relayRunning(): Promise<boolean>; // C3's relay check through engine.relayHealth { force: true }: the listener runs whenever ClaudeUsage does
  dataDirPresent(): Promise<boolean>; // C7's reader found ClaudeUsage's files
  now?(): number;
}

export interface ClaudeUsageApp {
  open(intent: ClaudeUsageOpenIntent): Promise<ClaudeUsageOpenResult>;
  status(): Promise<ClaudeUsageStatus>;
}

export function execRunner(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve({ stdout }))),
  );
}

// The control in ClaudeUsage's panel each intent names; the panel intent names none.
function control(intent: ClaudeUsageOpenIntent): string | null {
  switch (intent.intent) {
    case 'panel':
      return null;
    case 'addAccount':
      return 'Add account…';
    case 'reconnect':
      return `Reconnect… beside ${intent.accountEmail}`;
    case 'remove':
      return `Remove account… beside ${intent.accountEmail}`;
  }
}

function instruction(intent: ClaudeUsageOpenIntent, reason: ClaudeUsageOpenResult['reason']): string {
  const name = control(intent);
  const steps = name === null ? 'click its icon' : `click its icon, then ${name}`;
  if (reason === 'not_installed') return `ClaudeUsage is not installed · once it is, it sits in the menu bar: ${steps}`;
  if (reason === 'launch_failed') return `ClaudeUsage did not open · when it runs, it sits in the menu bar: ${steps}`;
  return `ClaudeUsage is in the menu bar · ${steps}`;
}

export function createClaudeUsageApp(deps: ClaudeUsageAppDeps): ClaudeUsageApp {
  const now = deps.now ?? Date.now;
  let installed: { value: boolean; at: number } | null = null;
  const remember = (value: boolean) => void (installed = { value, at: now() });

  const isInstalled = async (): Promise<boolean> => {
    if (installed && now() - installed.at < INSTALLED_TTL_MS) return installed.value;
    let found = false;
    try {
      found = (await deps.run('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${CLAUDE_USAGE_BUNDLE_ID}'`], MDFIND_TIMEOUT_MS)).stdout.trim() !== '';
    } catch {
      // Spotlight unavailable: nothing found
    }
    remember(found);
    return found;
  };

  return {
    async open(intent) {
      let reason: ClaudeUsageOpenResult['reason'] = null;
      try {
        await deps.run('/usr/bin/open', ['-b', CLAUDE_USAGE_BUNDLE_ID], OPEN_TIMEOUT_MS);
      } catch (error) {
        const { code, stderr } = error as { code?: unknown; stderr?: unknown };
        reason = typeof code === 'number' && code !== 0 && String(stderr).includes('Unable to find application') ? 'not_installed' : 'launch_failed';
      }
      if (reason !== 'launch_failed') remember(reason === null);
      return { opened: reason === null, reason, instruction: instruction(intent, reason) };
    },
    async status() {
      const [isThere, running, dataDirPresent] = await Promise.all([isInstalled(), deps.relayRunning(), deps.dataDirPresent()]);
      return { installed: isThere, running, bundleId: CLAUDE_USAGE_BUNDLE_ID, dataDirPresent, checkedAt: new Date(now()).toISOString() };
    },
  };
}

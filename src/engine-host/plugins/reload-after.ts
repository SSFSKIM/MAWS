// The reload after a plugin mutation (E8 execution document, M1 decisions; D-4): the engine applies nothing on its own,
// and a reload sent right after the CLI's write answers from its previous settings snapshot (G0: the settings watcher
// lags ~1.3 s), so MAWS waits SETTLE_MS, then reloads plugins in every session whose process is ready, in parallel. Each
// reload settles independently: its answer is compared with what the change should mean for that session (the plugin
// present after install and enable, absent after uninstall and disable, at the result's new version after an update,
// nothing to check after a marketplace verb), which applies to every session at user scope and only to the session in the operation's directory
// at project and local scope; a disagreeing session is reloaded once more after another settle, then reported
// `not_reflected`; a rejected reload is that session's `failed`, never the mutation's.
import { realpath } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionReload } from '@shared/ipc/schema/plugins';
import type { PluginsAction, PluginsScope } from '@shared/plugins/cli';
import type { ReloadPluginsResponse } from '@shared/wire/control';

export const SETTLE_MS = 3_000;

// The mutations after which running sessions are reloaded; `marketplace-add` loads no plugin by itself.
export const RELOADING_ACTIONS: ReadonlySet<PluginsAction> = new Set(['install', 'update', 'uninstall', 'enable', 'disable', 'marketplace-update', 'marketplace-remove']);

// A ready session: its launch directory, and one reload_plugins round trip whose success the caller has already applied
// to the session's status.
export interface ReloadTarget {
  id: AppSessionId;
  directory: string;
  reload(): Promise<ReloadPluginsResponse>;
}

export interface ReloadChange {
  action: PluginsAction;
  scope: PluginsScope; // the CLI's default, user, when the input named none
  cwd: string; // the operation's directory, where project and local scope write
  plugin: string | null; // the plugin's name (the id before its `@marketplace`); null for the marketplace verbs
  version: string | null; // an update's result `newVersion`, which the reload answer's plugin entry carries (pass3/e8-plugins-reload seq 31); null otherwise
}

export interface ReloadDeps {
  sleep(ms: number): Promise<void>;
}

export function expectationOf(action: PluginsAction): 'present' | 'absent' | 'version' | null {
  if (action === 'install' || action === 'enable') return 'present';
  if (action === 'uninstall' || action === 'disable') return 'absent';
  if (action === 'update') return 'version';
  return null;
}

const canonical = (path: string): Promise<string> => realpath(path).catch(() => path);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function reloadAfter(change: ReloadChange, targets: () => ReloadTarget[], deps: ReloadDeps): Promise<SessionReload[]> {
  if (targets().length === 0) return [];
  await deps.sleep(SETTLE_MS);
  const expectation = change.plugin === null ? null : expectationOf(change.action);
  const expected = expectation === 'version' && change.version === null ? null : expectation;
  const cwd = await canonical(change.cwd);
  const applies = async (target: ReloadTarget) => change.scope === 'user' || (await canonical(target.directory)) === cwd;
  const agrees = (answer: ReloadPluginsResponse) => (expected === 'version'
    ? answer.plugins.some((p) => p.name === change.plugin && p.version === change.version)
    : answer.plugins.some((p) => p.name === change.plugin) === (expected === 'present'));

  const one = async (target: ReloadTarget): Promise<SessionReload> => {
    const outcome = (value: SessionReload['outcome'], error: string | null = null): SessionReload => ({ appSessionId: target.id, outcome: value, error });
    try {
      const first = await target.reload();
      if (expected === null || !(await applies(target))) return outcome('no_expectation');
      if (agrees(first)) return outcome('reflected');
      await deps.sleep(SETTLE_MS);
      return outcome(agrees(await target.reload()) ? 'reflected' : 'not_reflected');
    } catch (error) {
      return outcome('failed', messageOf(error));
    }
  };
  return Promise.all(targets().map(one));
}

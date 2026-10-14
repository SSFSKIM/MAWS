// X20's commands (the P2-C document, §9): `mods.list` answers one row per built-in mod, `mods.setSessionOverride` writes
// a session's override of the to-human lane. Without a session a row's `source` is what a new launch in no project would
// do; with one it is the session's last applied state (or, before its first decided launch, what its next launch would
// do), plus `pending` while the effective lane differs from what is applied, and the style mismatch when the engine
// reported another style than the resolver read. The app's switch is `settings.set` on `mods.toHuman.enabled`.
import type { AppSessionId } from '@shared/graph/ids';
import { BUILT_IN_MODS, type ModId, type ModRow } from '@shared/mods/registry';
import type { ContractSource, LaneOverride, LanePending } from '@shared/owner/state';
import type { SessionStore } from '../index/sessions';
import { desiredSource, laneOn } from './launch';
import { resolveStyle } from './resolve-style';
import type { OwnerChannelStore, OwnerSessionRow } from './store';

export interface ModsDeps {
  store: OwnerChannelStore;
  sessions: Pick<SessionStore, 'get'>;
  appEnabled: () => boolean;
  configHome: () => Promise<string>; // the engine's config home (the captured login-shell environment's)
  managedSettingsPath?: string; // the tests' seam
}

export async function modsList(deps: ModsDeps, appSessionId?: AppSessionId): Promise<ModRow[]> {
  const appEnabled = deps.appEnabled();
  const [mod] = BUILT_IN_MODS; // the to-human lane, the one entry today
  const base = { id: mod!.id, name: mod!.name, description: mod!.description, version: mod!.version, enabled: appEnabled };
  if (appSessionId === undefined) return [{ ...base, source: await nextLaunchSource(deps, appEnabled, null) }];

  const row = deps.store.session(appSessionId);
  const override = row?.override ?? 'inherit';
  const on = laneOn(appEnabled, override);
  const directory = deps.sessions.get(appSessionId)?.directory ?? null;
  const source = row?.applied ?? (await nextLaunchSource(deps, on, directory));
  const pending = pendingOf(row, on);
  const mismatch = row?.styleMismatch && row.style !== null && row.observedStyle !== null ? { resolved: row.style, observed: row.observedStyle } : null;
  return [{ ...base, source, perSession: override, ...(pending === null ? {} : { pending }), ...(mismatch === null ? {} : { mismatch }) }];
}

export function setSessionOverride(deps: Pick<ModsDeps, 'store'>, input: { appSessionId: AppSessionId; id: ModId; value: LaneOverride }): void {
  deps.store.setOverride(input.appSessionId, input.value); // one mod today: the id names the to-human lane
}

// What a launch with the lane `on` in `directory` (null: no project) would desire.
async function nextLaunchSource(deps: ModsDeps, on: boolean, directory: string | null): Promise<ContractSource> {
  if (!on) return 'off';
  const style = await resolveStyle({ configHome: await deps.configHome(), cwd: directory, managedSettingsPath: deps.managedSettingsPath });
  return desiredSource(on, style.shape);
}

// Whether the instructions still differ from what the lane wants. Never decided while on: the next launch. Decided under
// the lane in force now: pending only when that launch wanted `--system-prompt-snapshot off` and the binary lacked it
// (a lane switch, a compatible style over the contract, or another contract version), until the next compaction; a
// style selected since that launch is not a lane change and reads nothing. The lane switched since that launch: the next
// launch, unless what that launch left in effect already matches it.
export function pendingOf(row: OwnerSessionRow | null, on: boolean): LanePending | null {
  if (row === null || row.desired === null || row.applied === null) return on ? 'next-launch' : null;
  if ((row.desired !== 'off') === on) return row.offUnavailable ? 'next-compaction' : null;
  return (row.applied !== 'off') === on ? null : 'next-launch';
}

// A terminal session's permission mode as its bridge reports it (sminos 1.27.14, doperpowers #445, board #160): the
// main loop's mode in the engine's word as the engine last reported it, when the bridge read that report (epoch ms, the
// session's machine's clock) and the event it came in (`permission_mode_changed`, `UserPromptSubmit`,
// `PermissionRequest`). The bridge carries the three fields on its heartbeat's `state` (the local driver's state
// stream) and on `read status`'s result (the remote adapter's), all three absent until the session reports a mode: its
// start reports none. Shown as reported, never inferred: nothing here reads a settings file or a launch flag. Main's two
// lane A halves read it here and put it in `LaneAState.mode` only from a bridge that reports it.
import { PERMISSION_MODES, type PermissionMode } from '../graph/enums';
import type { LaneAMode } from '../ipc/schema/lane-a';

/** The sminos whose bridge first reports the mode: what an older one says is not its report. */
export const MODE_SINCE = '1.27.14';

const version = (text: string): number[] | null => /^(\d+)\.(\d+)\.(\d+)/.exec(text)?.slice(1).map(Number) ?? null;

/** Whether a bridge of this `capabilities.sminos` reports the session's mode. */
export function reportsMode(sminos: string | null): boolean {
  const have = sminos === null ? null : version(sminos);
  if (have === null) return false;
  const since = version(MODE_SINCE)!;
  const at = have.findIndex((n, i) => n !== since[i]);
  return at === -1 || have[at]! > since[at]!;
}

/** The report a heartbeat's `state` or a `read status` result carries; null while it carries none, or a word that is
 * none of the engine's modes. */
export function modeOf(fields: Record<string, unknown> | null): LaneAMode | null {
  const mode = fields?.permissionMode;
  const at = fields?.permissionModeAt;
  const from = fields?.permissionModeFrom;
  if (!PERMISSION_MODES.includes(mode as PermissionMode) || typeof at !== 'number' || !Number.isFinite(at) || typeof from !== 'string') return null;
  return { mode: mode as PermissionMode, at, from };
}

/** Whether two reports are the same one. */
export const sameMode = (a: LaneAMode | null, b: LaneAMode | null): boolean => a === b || (a !== null && b !== null && a.mode === b.mode && a.at === b.at && a.from === b.from);

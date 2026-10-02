// What MAWS knows about the Claude Code versions it runs (charter D-1 as amended 2026-10-01, W13; waves plan §2 J1),
// keyed by `claude_code_version`: the version its fixtures and conformance tests were recorded on, a comparison, and the
// one notice a session gets when an engine newer than that sends something MAWS did not understand. Information only:
// the product runs whatever Claude Code the user has installed and never refuses a version.
import { ENGINE_COMPAT_NOTICE_KEY } from '@shared/engine/compat-notice';
import type { SessionEvent } from '@shared/graph/events';

export { ENGINE_COMPAT_NOTICE_KEY };

export const TESTED_ENGINE_VERSION = '2.1.283';

// The numeric parts of a version (`2.1.287`, `2.1.290-dev`); null when it does not start with one.
function partsOf(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}

// Negative, zero or positive as `a` is older than, the same release as, or newer than `b`; null when either is not a
// version. A suffix after the three numbers is not ordered (2.1.290-dev reads as 2.1.290).
export function compareVersions(a: string, b: string): number | null {
  const x = partsOf(a);
  const y = partsOf(b);
  if (x === null || y === null) return null;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

export const newerThanTested = (version: string | null): boolean => version !== null && (compareVersions(version, TESTED_ENGINE_VERSION) ?? 0) > 0;

export const engineCompatNotice = (version: string): string =>
  `Claude Code ${version} is newer than the version MAWS was verified against (${TESTED_ENGINE_VERSION}); some events were not understood`;

// What the engine sent that MAWS could not read: a frame of a type or subtype it does not map, or a known frame that
// failed its schema.
const notUnderstood = (event: SessionEvent): boolean => event.kind === 'frame.unknown' || (event.kind === 'error.raised' && event.code === 'invalid_frame');

// One per session process: the first batch of events normalised from the engine's own output that holds something not
// understood, while the session runs a version newer than tested, answers the notice's text; every later call answers
// null. On the tested version (or an older one) nothing is answered, and a later unknown frame still may raise it if the
// version read then is newer.
export class EngineCompatWatch {
  private raised = false;

  observe(events: readonly SessionEvent[], version: string | null): string | null {
    if (this.raised || !newerThanTested(version) || !events.some(notUnderstood)) return null;
    this.raised = true;
    return engineCompatNotice(version!);
  }
}

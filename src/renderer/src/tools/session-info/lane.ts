// The auto-mode lane (C11 execution document, Interfaces "Session info tool", the lane paragraph; §19): which classifier
// reviews a session's tool calls in auto mode, derived rather than read. `get_status`'s `Auto mode server` row reports
// the client-side switch, not the last verdict, and the lane is decided per request by the main model's provider, so
// the row is one input beside the model's gateway-ness, fast mode, the refusal and C3's `localLane`, which counts only
// while it belongs to the open turn (its `observedInTurn` is the turn's `turn.started` EventId; C3 clears it at the
// next one). Pure.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import { MODE_REFUSAL_WORDS } from '../../statusline/mode-menu';
import type { TranscriptState } from '../../transcript/model/reduce';
import { isGatewayModel } from '@shared/sessions/models';
import { LANE } from './copy';

// `unknown` (the row not read yet) is the one kind beyond the document's five: it renders `Not read yet`.
export type LaneKind = 'server' | 'local_expected' | 'local_observed' | 'off' | 'unavailable' | 'unknown';
export type Reviews = { evaluated: number; flagged: number };
export type Lane = { kind: LaneKind; sentence: string; reviews: Reviews | null };

// The catalogue entry of the session's model, when known (only its value is read).
export type LaneModelEntry = { value: string } | null;

// `account`: who the local lane's requests are counted against, in words (the pinned or routing account, or the
// engine's own login); `null` when not known.
export function autoModeLane(status: EngineSessionStatus, entry: LaneModelEntry, reviews: Reviews | null, account: string | null = null): Lane {
  // the counts belong to a lane that reviews: none beside `off` or `unavailable`
  const lane = (kind: LaneKind, sentence: string): Lane => ({ kind, sentence, reviews: kind === 'off' || kind === 'unavailable' ? null : reviews });
  const { effective, refusal } = status.permissionMode;
  // A refusal first: it is set exactly when the requested auto mode was not honoured, so the effective mode is another.
  if (refusal !== null) return lane('unavailable', MODE_REFUSAL_WORDS[refusal]);
  if (effective !== 'auto') return lane('off', LANE.off(effective));
  const observed = status.gateway.localLane;
  if (observed !== null && status.turn !== null && status.turn.id === observed.observedInTurn) return lane('local_observed', LANE.observed(account ?? LANE.someAccount));
  const model = entry?.value ?? status.model.requested ?? status.model.resolved;
  if (model !== null && isGatewayModel(model)) return lane('local_expected', LANE.expectedGateway);
  if (status.fastMode.state === 'on') return lane('local_expected', LANE.expectedFast);
  if (status.gateway.autoModeServer === 'enabled') return lane('server', LANE.server);
  if (status.gateway.autoModeServer === 'disabled') return lane('local_expected', LANE.expectedDisabled);
  return lane('unknown', LANE.unknown);
}

// The session's tool calls the server lane evaluated, from C6's transcript: each tool use counted once, by its latest
// verdict (a `tool.safeguard` event, or the verdict folded onto its result); null when no transcript is held or it
// holds no turn yet (nothing to count is not "0 evaluated").
export function reviewsOf(state: TranscriptState | undefined): Reviews | null {
  if (!state || state.order.length === 0) return null;
  const verdicts = new Map<string, 'skipped' | 'not_flagged' | 'flagged'>();
  const note = (event: SessionEvent) => {
    if (event.kind === 'tool.safeguard') verdicts.set(event.toolUseId, event.verdict);
    else if (event.kind === 'tool.result' && event.safeguard !== 'not_evaluated') verdicts.set(event.toolUseId, event.safeguard);
  };
  for (const turn of state.turns.values()) {
    turn.events.forEach(note);
    for (const child of turn.children.values()) child.forEach(note);
  }
  const all = [...verdicts.values()].filter((v) => v !== 'skipped');
  return { evaluated: all.length, flagged: all.filter((v) => v === 'flagged').length };
}

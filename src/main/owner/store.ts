// The owner channel's two tables (the P2-C document, §10; index migration 7). `owner_channel_sessions`: per session the
// lane's override (`mods.setSessionOverride`; a fork and a side thread inherit their parent's), the watermark
// (`enabled_at`, Design §5), the last decided launch (Design §2: desired, recorded, the flags passed, applied, the
// resolved style) and the style the engine reported at that launch's first `session.init` (the mismatch check).
// `owner_channel_marks`: per question and essential its state, answer and times (Design §5, §6). Both go with the
// session's record. The attention items of the two owner kinds are a projection of the marks, never the truth.
import type { AppSessionId } from '@shared/graph/ids';
import type { AnswerMember, ContractSource, LaneOverride } from '@shared/owner/state';
import type { Db, Value } from '../index/db';
import type { RecordedState } from './prompt-state';

export interface OwnerSessionRow {
  appSessionId: AppSessionId;
  override: LaneOverride;
  enabledAt: string | null; // the watermark: set at the first lane-on decided launch, cleared at a lane-off one
  launchId: string | null; // the last decided launch
  launchedAt: string | null;
  desired: ContractSource | null;
  recorded: RecordedState | null;
  appended: boolean; // --append-system-prompt passed
  snapshotOff: boolean; // --system-prompt-snapshot off passed
  offUnavailable: boolean; // "off" was wanted and the binary did not declare it: the change waits for a compaction
  applied: ContractSource | null; // the instructions in effect after that launch
  style: string | null; // the resolver's style name for it (read from the settings, whatever a mismatch decided by)
  observedStyle: string | null; // the engine's, at its first session.init
  styleMismatch: boolean;
}

// What a decided launch writes when the host answers `launching`.
export interface LaunchRecord {
  launchId: string;
  at: string;
  laneOn: boolean;
  desired: ContractSource;
  recorded: RecordedState;
  appended: boolean;
  snapshotOff: boolean;
  offUnavailable: boolean;
  applied: ContractSource;
  style: string;
}

export type OwnerMarkState = 'unanswered' | 'queued' | 'unconfirmed' | 'delivered' | 'unread' | 'read' | 'retired';

export interface OwnerMarkRow {
  id: string; // markIdOf's
  appSessionId: AppSessionId;
  kind: 'need-input' | 'essential';
  messageUuid: string;
  blockIndex: number;
  span: number;
  grammar: number;
  head: string;
  at: string;
  item: boolean; // item-eligible: at or after the watermark when derived
  live: boolean; // from a MAWS process while the lane was on and the session not foreign-held
  state: OwnerMarkState;
  answerText: string | null;
  answerOrigin: 'answer' | 'reply' | 'legacy' | null;
  answerMembers: AnswerMember[];
  answeredAt: string | null;
  readAt: string | null;
  stateChangedAt: string;
}

interface SessionRow {
  app_session_id: string;
  override: LaneOverride;
  enabled_at: string | null;
  launch_id: string | null;
  launched_at: string | null;
  desired: ContractSource | null;
  recorded: string | null;
  appended: number;
  snapshot_off: number;
  off_unavailable: number;
  applied: ContractSource | null;
  style: string | null;
  observed_style: string | null;
  style_mismatch: number;
}

interface MarkRow {
  id: string;
  app_session_id: string;
  kind: OwnerMarkRow['kind'];
  message_uuid: string;
  block_index: number;
  span: number;
  grammar: number;
  head: string;
  at: string;
  item: number;
  live: number;
  state: OwnerMarkState;
  answer_text: string | null;
  answer_origin: OwnerMarkRow['answerOrigin'];
  answer_members: string;
  answered_at: string | null;
  read_at: string | null;
  state_changed_at: string;
}

const toSession = (row: SessionRow): OwnerSessionRow => ({
  appSessionId: row.app_session_id as AppSessionId,
  override: row.override,
  enabledAt: row.enabled_at,
  launchId: row.launch_id,
  launchedAt: row.launched_at,
  desired: row.desired,
  recorded: row.recorded as RecordedState | null,
  appended: row.appended === 1,
  snapshotOff: row.snapshot_off === 1,
  offUnavailable: row.off_unavailable === 1,
  applied: row.applied,
  style: row.style,
  observedStyle: row.observed_style,
  styleMismatch: row.style_mismatch === 1,
});

const toMark = (row: MarkRow): OwnerMarkRow => ({
  id: row.id,
  appSessionId: row.app_session_id as AppSessionId,
  kind: row.kind,
  messageUuid: row.message_uuid,
  blockIndex: row.block_index,
  span: row.span,
  grammar: row.grammar,
  head: row.head,
  at: row.at,
  item: row.item === 1,
  live: row.live === 1,
  state: row.state,
  answerText: row.answer_text,
  answerOrigin: row.answer_origin,
  answerMembers: JSON.parse(row.answer_members) as AnswerMember[],
  answeredAt: row.answered_at,
  readAt: row.read_at,
  stateChangedAt: row.state_changed_at,
});

// The mark fields a caller may change after the mark is stored; its identity, kind and derivation facts never change.
export type MarkUpdate = Partial<Pick<OwnerMarkRow, 'state' | 'answerText' | 'answerOrigin' | 'answerMembers' | 'answeredAt' | 'readAt' | 'stateChangedAt' | 'item' | 'live'>>;
const MARK_COLUMNS: Record<keyof MarkUpdate, string> = {
  state: 'state', answerText: 'answer_text', answerOrigin: 'answer_origin', answerMembers: 'answer_members', answeredAt: 'answered_at',
  readAt: 'read_at', stateChangedAt: 'state_changed_at', item: 'item', live: 'live',
};

export class OwnerChannelStore {
  constructor(private readonly db: Db) {}

  session(appSessionId: AppSessionId): OwnerSessionRow | null {
    const row = this.db.get<SessionRow>('SELECT * FROM owner_channel_sessions WHERE app_session_id = ?', appSessionId);
    return row === null ? null : toSession(row);
  }

  override(appSessionId: AppSessionId): LaneOverride {
    return this.session(appSessionId)?.override ?? 'inherit';
  }

  setOverride(appSessionId: AppSessionId, value: LaneOverride): void {
    this.db.transaction(() => {
      this.known(appSessionId);
      this.db.run(
        'INSERT INTO owner_channel_sessions (app_session_id, override) VALUES (?, ?) ON CONFLICT (app_session_id) DO UPDATE SET override = excluded.override',
        appSessionId, value,
      );
    });
  }

  // A fork or a side thread takes its parent's override when its record is created (Design §9); a parent that never
  // set one leaves the child without a row.
  inheritOverride(child: AppSessionId, parent: AppSessionId): void {
    const value = this.override(parent);
    if (value !== 'inherit') this.setOverride(child, value);
  }

  // A decided launch the host answered `launching` for. The watermark is set at a lane-on launch when it is unset, and
  // cleared at a lane-off one (Design §5); the override and the observed style are kept.
  recordLaunch(appSessionId: AppSessionId, launch: LaunchRecord): void {
    this.db.transaction(() => {
      this.known(appSessionId);
      this.db.run('INSERT INTO owner_channel_sessions (app_session_id) VALUES (?) ON CONFLICT (app_session_id) DO NOTHING', appSessionId);
      const values: Record<string, Value> = {
        launch_id: launch.launchId, launched_at: launch.at, desired: launch.desired, recorded: launch.recorded, appended: launch.appended,
        snapshot_off: launch.snapshotOff, off_unavailable: launch.offUnavailable, applied: launch.applied, style: launch.style,
      };
      if (!launch.laneOn) values.enabled_at = null;
      else if ((this.session(appSessionId)?.enabledAt ?? null) === null) values.enabled_at = launch.at;
      this.db.update('owner_channel_sessions', 'app_session_id', appSessionId, values);
    });
  }

  // The style the engine reported at a decided launch's first `session.init`, and whether it differs from the resolver's.
  recordObserved(appSessionId: AppSessionId, observed: string, mismatch: boolean): void {
    this.db.update('owner_channel_sessions', 'app_session_id', appSessionId, { observed_style: observed, style_mismatch: mismatch });
  }

  marks(appSessionId: AppSessionId): OwnerMarkRow[] {
    return this.db.all<MarkRow>('SELECT * FROM owner_channel_marks WHERE app_session_id = ? ORDER BY at, rowid', appSessionId).map(toMark);
  }

  // M4 start (2026-10-09): what main's owner channel reads at start and per command
  mark(id: string): OwnerMarkRow | null {
    const row = this.db.get<MarkRow>('SELECT * FROM owner_channel_marks WHERE id = ?', id);
    return row === null ? null : toMark(row);
  }

  // Every question whose answer is still on its way (queued or unconfirmed), across sessions.
  openAnswers(): OwnerMarkRow[] {
    return this.db.all<MarkRow>("SELECT * FROM owner_channel_marks WHERE state IN ('queued', 'unconfirmed') ORDER BY at, rowid").map(toMark);
  }

  // The sessions holding any mark.
  markedSessions(): AppSessionId[] {
    return this.db.all<{ app_session_id: string }>('SELECT DISTINCT app_session_id FROM owner_channel_marks ORDER BY app_session_id').map((row) => row.app_session_id as AppSessionId);
  }
  // M4 end

  // Idempotent on the mark's id: a replay, a resync burst or a backfill re-delivering a mark changes nothing. True when
  // the mark is new. Only the id's conflict is skipped (not `OR IGNORE`, which would also drop a row failing a CHECK).
  putMark(mark: OwnerMarkRow): boolean {
    return (
      this.db.run(
        `INSERT INTO owner_channel_marks (id, app_session_id, kind, message_uuid, block_index, span, grammar, head, at, item, live, state,
          answer_text, answer_origin, answer_members, answered_at, read_at, state_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO NOTHING`,
        mark.id, mark.appSessionId, mark.kind, mark.messageUuid, mark.blockIndex, mark.span, mark.grammar, mark.head, mark.at, mark.item ? 1 : 0, mark.live ? 1 : 0,
        mark.state, mark.answerText, mark.answerOrigin, JSON.stringify(mark.answerMembers), mark.answeredAt, mark.readAt, mark.stateChangedAt,
      ) === 1
    );
  }

  updateMark(id: string, update: MarkUpdate): void {
    const values: Record<string, Value> = {};
    for (const [key, value] of Object.entries(update) as [keyof MarkUpdate, MarkUpdate[keyof MarkUpdate]][]) {
      if (value === undefined) continue;
      values[MARK_COLUMNS[key]] = key === 'answerMembers' ? JSON.stringify(value) : (value as Value);
    }
    this.db.update('owner_channel_marks', 'id', id, values);
  }

  private known(appSessionId: AppSessionId): void {
    if (this.db.get('SELECT 1 FROM sessions WHERE app_id = ?', appSessionId) === null) throw new Error(`unknown app session: ${appSessionId}`);
  }
}

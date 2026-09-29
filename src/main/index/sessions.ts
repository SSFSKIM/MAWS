// App session records (X1) in the index (C4 execution document, Interfaces "Index"): the `sessions` row projected to
// C1's `SessionRecord`. Discovery facts come from transcript summaries; the engine's live facts from C3's status; the
// owner's own marks (pin, archive, read state, a MAWS-side title) only from `session.update`. Every change is announced
// once per record after its transaction commits (`onChange`), and every change of the engine-id binding likewise
// (`onBinding`), which the session source forwards to the engine host as `fs.bind` / `fs.unbind`.
//
// Title rule: the engine's titles are facts (`custom_title`, `ai_title`, `first_prompt`, overwritten by every summary);
// a rename made in MAWS is an override kept apart (`title_override`), together with the engine's custom title at the
// moment it was set, and a later summary whose custom title differs from that clears the override: the later explicit
// act wins in either direction. Projection: override, else custom title (`user`), else AI title (`generated`), else first
// prompt (`none`), else an empty title.
import { randomUUID } from 'node:crypto';
import type { AppSessionId, MessageUuid, ProjectId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { Holder, TranscriptSummary } from '@shared/wire/store';
import type { Db, Value } from './db';
import type { EngineStatusPatch } from './engine-status';
import { locate, type ProjectStore } from './projects';

export type ChangeCause = 'discovered' | 'facts' | 'holder' | 'update' | 'live' | 'replay' | 'removed';

interface SessionRow {
  app_id: string;
  engine_session_id: string | null;
  project_id: string | null;
  directory: string;
  additional_directories: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  branch: string | null;
  custom_title: string | null;
  ai_title: string | null;
  title_override: string | null;
  title_override_engine_title: string | null;
  pinned: number;
  archived: number;
  holder: string;
  last_seen_uuid: string | null;
  last_seen_at: string | null;
  unread: number;
  engine_version: string | null;
  gateway_routed: number;
  gateway_base_url: string | null;
  gateway_auto_mode_server: string;
  model_requested: string | null;
  model_resolved: string | null;
  effort: string | null;
  pm_requested: string;
  pm_effective: string;
  pm_refusal: string | null;
  transcript_path: string | null;
  transcript_size: number | null;
  transcript_mtime_ms: number | null;
  first_record_at: string | null;
  last_record_at: string | null;
  last_assistant_text: string | null;
  first_prompt: string | null;
  summary: string | null;
  removed_at: string | null; // set when fs.sessionRemoved archived the record (not the owner); cleared when it returns
  kind: 'engine' | 'replay';
  created_at: string;
  updated_at: string;
}

export interface LaunchInit {
  appSessionId?: AppSessionId; // C10's: the id it allocated for the unstarted tab (UUID v4); allocated here when absent
  directory: string;
  additionalDirectories: string[];
  worktree: SessionRecord['worktree'];
  model: SessionRecord['model'];
  effort: SessionRecord['effort'];
  permissionMode: SessionRecord['permissionMode'];
}

// What the engine host needs to know of a record's engine id: bound (fs.scan's `known` when a transcript is on disk).
export interface Binding {
  sessionId: SessionId;
  appSessionId: AppSessionId;
  size: number | null;
  mtimeMs: number | null;
}

// A committed change of a record's engine-id binding: the id it is bound to now (null: unbound, or the record removed).
export interface BindingChange {
  appSessionId: AppSessionId;
  sessionId: SessionId | null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function titleOf(row: SessionRow): SessionRecord['title'] {
  if (row.title_override !== null) return JSON.parse(row.title_override) as SessionRecord['title'];
  if (row.custom_title) return { text: row.custom_title, source: 'user' };
  if (row.ai_title) return { text: row.ai_title, source: 'generated' };
  if (row.first_prompt) return { text: row.first_prompt, source: 'none' };
  return { text: '', source: 'none' };
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    appId: row.app_id as AppSessionId,
    engineSessionId: row.engine_session_id as SessionId | null,
    projectId: row.project_id as ProjectId | null,
    directory: row.directory,
    additionalDirectories: JSON.parse(row.additional_directories) as string[],
    worktree: row.worktree_path === null ? null : { path: row.worktree_path, branch: row.worktree_branch },
    branch: row.branch,
    title: titleOf(row),
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    holder: JSON.parse(row.holder) as Holder,
    lastSeen: { messageUuid: row.last_seen_uuid as MessageUuid | null, at: row.last_seen_at },
    unread: row.unread === 1,
    engineVersion: row.engine_version,
    gateway: { routed: row.gateway_routed === 1, baseUrl: row.gateway_base_url, autoModeServer: row.gateway_auto_mode_server as SessionRecord['gateway']['autoModeServer'] },
    model: { requested: row.model_requested, resolved: row.model_resolved },
    effort: row.effort,
    permissionMode: {
      requested: row.pm_requested as SessionRecord['permissionMode']['requested'],
      effective: row.pm_effective as SessionRecord['permissionMode']['effective'],
      refusal: row.pm_refusal as SessionRecord['permissionMode']['refusal'],
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SessionStore {
  private readonly changeListeners = new Set<(record: SessionRecord, cause: ChangeCause, revision: number) => void>();
  private readonly bindingListeners = new Set<(change: BindingChange) => void>();
  private readonly removed = new Map<string, SessionRecord>(); // the last record of a row deleted in the open transaction

  constructor(
    private readonly db: Db,
    private readonly projects: ProjectStore,
    private readonly stamp: () => number, // the index-wide revision, taken once per committed change
  ) {}

  list(opts: { includeArchived?: boolean } = {}): SessionRecord[] {
    const where = opts.includeArchived ? '' : 'WHERE archived = 0';
    return this.db.all<SessionRow>(`SELECT * FROM sessions ${where} ORDER BY last_record_at DESC, created_at DESC`).map(toRecord);
  }

  // The last summary discovery reported for each record that has one.
  summaries(): Map<AppSessionId, TranscriptSummary> {
    const rows = this.db.all<{ app_id: string; summary: string }>('SELECT app_id, summary FROM sessions WHERE summary IS NOT NULL');
    return new Map(rows.map((row) => [row.app_id as AppSessionId, JSON.parse(row.summary) as TranscriptSummary]));
  }

  summaryOf(appId: AppSessionId): TranscriptSummary | null {
    const row = this.db.get<{ summary: string | null }>('SELECT summary FROM sessions WHERE app_id = ?', appId);
    return row?.summary ? (JSON.parse(row.summary) as TranscriptSummary) : null;
  }

  get(appId: AppSessionId): SessionRecord | null {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE app_id = ?', appId);
    return row ? toRecord(row) : null;
  }

  getByEngineId(sessionId: SessionId): SessionRecord | null {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE engine_session_id = ?', sessionId);
    return row ? toRecord(row) : null;
  }

  // Every engine session's record bound to an engine id, with its transcript's size and mtime while one is on disk.
  // Replay records are not among them: their ids live only as long as the host's runner.
  bindings(): Binding[] {
    return this.db
      .all<{ engine_session_id: string; app_id: string; transcript_path: string | null; transcript_size: number | null; transcript_mtime_ms: number | null }>(
        "SELECT engine_session_id, app_id, transcript_path, transcript_size, transcript_mtime_ms FROM sessions WHERE engine_session_id IS NOT NULL AND kind = 'engine'",
      )
      .map((row) => ({
        sessionId: row.engine_session_id as SessionId,
        appSessionId: row.app_id as AppSessionId,
        size: row.transcript_path === null ? null : row.transcript_size,
        mtimeMs: row.transcript_path === null ? null : row.transcript_mtime_ms,
      }));
  }

  // Discovery: the record for the summary's engine id, created (with a fresh app id) when there is none. Overwrites the
  // engine-sourced columns; never pin, archive or read state; touches the title override only by the Title rule.
  // `advanced` is true when the transcript's last record moved past the one the index held (the unread rule's input);
  // a first sighting is not an advance.
  upsertFromSummary(summary: TranscriptSummary): { record: SessionRecord; created: boolean; advanced: boolean } {
    return this.db.transaction(() => {
      const existing = this.db.get<SessionRow>('SELECT * FROM sessions WHERE engine_session_id = ?', summary.sessionId);
      const location = locate(summary.relocatedCwd ?? summary.directory);
      const projectId = this.projects.projectAt(location, summary.hasMessages);
      const facts: Record<string, Value> = {
        project_id: projectId,
        directory: location.realpath ?? summary.relocatedCwd ?? summary.directory ?? existing?.directory ?? '',
        worktree_path: location.worktreePath,
        worktree_branch: location.worktreePath === null ? null : summary.gitBranch,
        branch: summary.gitBranch ?? existing?.branch ?? null,
        custom_title: summary.customTitle,
        ai_title: summary.aiTitle,
        first_prompt: summary.firstPrompt,
        engine_version: summary.engineVersion ?? existing?.engine_version ?? null,
        transcript_path: summary.transcriptPath,
        transcript_size: summary.size,
        transcript_mtime_ms: summary.mtimeMs,
        first_record_at: summary.firstRecordAt,
        last_record_at: summary.lastRecordAt,
        last_assistant_text: summary.lastAssistantText,
        summary: JSON.stringify(summary),
      };

      if (!existing) {
        const appId = randomUUID() as AppSessionId;
        const now = new Date().toISOString();
        this.db.insert('sessions', { app_id: appId, engine_session_id: summary.sessionId, ...facts, created_at: now, updated_at: now });
        this.changed(appId, 'discovered');
        this.bindingChanged(appId);
        return { record: this.require(appId), created: true, advanced: false };
      }

      // A transcript back after its removal (a relocation: removed, then seen at its new path) lifts the archive the
      // removal made; an archive the owner made is theirs and stays.
      if (existing.removed_at !== null) {
        facts.archived = false;
        facts.removed_at = null;
      }
      // A terminal `/rename` after a MAWS rename wins: the override yields once the engine's custom title moves.
      if (existing.title_override !== null && summary.customTitle !== existing.title_override_engine_title) {
        facts.title_override = null;
        facts.title_override_engine_title = null;
      }
      const advanced = existing.last_record_at !== null && summary.lastRecordAt !== null && summary.lastRecordAt > existing.last_record_at;
      const appId = existing.app_id as AppSessionId;
      if (this.write(existing, facts)) this.changed(appId, 'facts');
      return { record: this.require(appId), created: false, advanced };
    });
  }

  // `fs.sessionRemoved`: the transcript is gone (retention sweep, quarantine, the first half of a relocation). The
  // record stays, archived, with no path; `removed_at` marks the archive as the removal's, so a transcript that comes
  // back lifts it. A record the owner had archived already keeps the owner's archive, unmarked.
  markTranscriptRemoved(sessionId: SessionId): SessionRecord | null {
    return this.db.transaction(() => {
      const existing = this.db.get<SessionRow>('SELECT * FROM sessions WHERE engine_session_id = ?', sessionId);
      if (!existing) return null;
      const values: Record<string, Value> = { archived: true, transcript_path: null };
      if (existing.archived === 0) values.removed_at = new Date().toISOString();
      if (this.write(existing, values)) this.changed(existing.app_id as AppSessionId, 'facts');
      return this.require(existing.app_id as AppSessionId);
    });
  }

  // A foreign holder from the registry. A record MAWS itself holds (`self`, C3's) is left alone.
  setHolder(sessionId: SessionId, holder: Holder): SessionRecord | null {
    return this.db.transaction(() => {
      const existing = this.db.get<SessionRow>('SELECT * FROM sessions WHERE engine_session_id = ?', sessionId);
      if (!existing) return null;
      const appId = existing.app_id as AppSessionId;
      if ((JSON.parse(existing.holder) as Holder).kind === 'self') return this.require(appId);
      if (this.write(existing, { holder: JSON.stringify(holder) })) this.changed(appId, 'holder');
      return this.require(appId);
    });
  }

  // C3 and C10: a record before the engine has a session id. A caller-supplied id that already has a row answers
  // `exists` with that row, so a restart reconciliation reuses it.
  createForLaunch(init: LaunchInit): { ok: true; record: SessionRecord } | { ok: false; reason: 'exists'; record: SessionRecord } {
    return this.db.transaction(() => {
      const appId = init.appSessionId ?? (randomUUID() as AppSessionId);
      if (!UUID_V4.test(appId)) throw new Error(`not a UUID v4: ${appId}`);
      const existing = this.get(appId);
      if (existing) return { ok: false, reason: 'exists', record: existing };
      const membership = this.projects.resolveMembership(init.directory);
      const now = new Date().toISOString();
      this.db.insert('sessions', {
        app_id: appId,
        project_id: membership.projectId,
        directory: init.directory,
        additional_directories: JSON.stringify(init.additionalDirectories),
        worktree_path: init.worktree?.path ?? null,
        worktree_branch: init.worktree?.branch ?? null,
        model_requested: init.model.requested,
        model_resolved: init.model.resolved,
        effort: init.effort,
        pm_requested: init.permissionMode.requested,
        pm_effective: init.permissionMode.effective,
        pm_refusal: init.permissionMode.refusal,
        created_at: now,
        updated_at: now,
      });
      this.changed(appId, 'live');
      return { ok: true, record: this.require(appId) };
    });
  }

  // C3: a status carrying the engine's session id, the first or a different one (the engine's `/clear` starts a new
  // transcript under the same process; C3 live acceptance, 2026-09-29). The host learns the pair through `onBinding`
  // (fs.bind), which replaces whatever pair the app id held. `bindRow` says what a rebind does to the old transcript.
  bindEngineId(appId: AppSessionId, sessionId: SessionId): SessionRecord {
    return this.db.transaction(() => {
      const existing = this.row(appId);
      this.bindRow(existing, sessionId, 'live');
      return this.require(appId);
    });
  }

  // C10: clears the engine id (and, through `onBinding`, the host's pair: fs.unbind), everything else untouched. A
  // transcript later discovered under that engine id becomes a fresh record.
  unbindEngineId(appId: AppSessionId): SessionRecord {
    return this.db.transaction(() => {
      const existing = this.row(appId);
      if (this.write(existing, { engine_session_id: null })) {
        this.changed(appId, 'update');
        this.bindingChanged(appId);
      }
      return this.require(appId);
    });
  }

  // C3's `toSessionRecordPatch(status)`, applied as it stands: the engine id binds, the holder is C3's to set.
  applyEngineStatus(appId: AppSessionId, patch: EngineStatusPatch): SessionRecord {
    return this.db.transaction(() => {
      const existing = this.row(appId);
      if (patch.engineSessionId !== undefined && patch.engineSessionId !== null) this.bindRow(existing, patch.engineSessionId, 'live');
      const values: Record<string, Value> = {};
      if (patch.engineVersion !== undefined) values.engine_version = patch.engineVersion;
      if (patch.holder !== undefined) values.holder = JSON.stringify(patch.holder);
      if (patch.gateway !== undefined) {
        values.gateway_routed = patch.gateway.routed;
        values.gateway_base_url = patch.gateway.baseUrl;
        values.gateway_auto_mode_server = patch.gateway.autoModeServer;
      }
      if (patch.model !== undefined) {
        values.model_requested = patch.model.requested;
        values.model_resolved = patch.model.resolved;
      }
      if (patch.effort !== undefined) values.effort = patch.effort;
      if (patch.permissionMode !== undefined) {
        values.pm_requested = patch.permissionMode.requested;
        values.pm_effective = patch.permissionMode.effective;
        values.pm_refusal = patch.permissionMode.refusal;
      }
      if (this.write(this.row(appId), values)) this.changed(appId, 'live');
      return this.require(appId);
    });
  }

  // The human has seen the session up to `cursor`: lastSeen moves and unread clears.
  markSeen(appId: AppSessionId, cursor: { messageUuid: MessageUuid | null; at: string }): SessionRecord {
    return this.set(appId, { last_seen_uuid: cursor.messageUuid, last_seen_at: cursor.at, unread: false }, 'update');
  }

  setUnread(appId: AppSessionId, unread: boolean): SessionRecord {
    return this.set(appId, { unread }, 'update');
  }

  setPinned(appId: AppSessionId, pinned: boolean): SessionRecord {
    return this.set(appId, { pinned }, 'update');
  }

  // C10's rename with provenance (the override of the Title rule; null clears it), archive, and a launch's worktree
  // and branch.
  update(appId: AppSessionId, patch: { title?: { text: string; source: 'user' | 'tool' } | null; archived?: boolean; worktree?: SessionRecord['worktree']; branch?: string | null }): SessionRecord {
    return this.db.transaction(() => {
      const existing = this.row(appId);
      const values: Record<string, Value> = {};
      if (patch.title !== undefined) {
        values.title_override = patch.title === null ? null : JSON.stringify({ text: patch.title.text, source: patch.title.source });
        values.title_override_engine_title = patch.title === null ? null : existing.custom_title;
      }
      if (patch.archived !== undefined) {
        values.archived = patch.archived;
        values.removed_at = null; // the owner's act owns the flag from now on
      }
      if (patch.worktree !== undefined) {
        values.worktree_path = patch.worktree?.path ?? null;
        values.worktree_branch = patch.worktree?.branch ?? null;
      }
      if (patch.branch !== undefined) values.branch = patch.branch;
      if (this.write(existing, values)) this.changed(appId, 'update');
      return this.require(appId);
    });
  }

  // M5's replay runs: a `kind: 'replay'` record under the run's fresh ids, titled by the fixture (the override, `tool`).
  createReplay(init: { appId: AppSessionId; sessionId: SessionId; title: string }): SessionRecord {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.insert('sessions', {
        app_id: init.appId,
        engine_session_id: init.sessionId,
        directory: '',
        title_override: JSON.stringify({ text: init.title, source: 'tool' }),
        kind: 'replay',
        created_at: now,
        updated_at: now,
      });
      // No binding notice: the engine host binds a replay's ids itself when it launches the run (M5).
      this.changed(init.appId, 'replay');
      return this.require(init.appId);
    });
  }

  // Deletes the row (its drafts and attention items go with it). Removing an id with no row does nothing.
  remove(appId: AppSessionId): void {
    this.db.transaction(() => {
      const existing = this.get(appId);
      if (existing) this.deleteRow(existing);
    });
  }

  // After commit, once per record per transaction, with the record as committed, the transaction's first cause for it,
  // and the revision stamped for this change.
  onChange(listener: (record: SessionRecord, cause: ChangeCause, revision: number) => void): () => void {
    this.changeListeners.add(listener);
    return () => void this.changeListeners.delete(listener);
  }

  // After commit, per record whose engine id changed, in commit order.
  onBinding(listener: (change: BindingChange) => void): () => void {
    this.bindingListeners.add(listener);
    return () => void this.bindingListeners.delete(listener);
  }

  // Sessions without a project whose directory is `directory` or lies in one of its worktrees join a new project.
  attachOrphans(projectId: ProjectId, directory: string): void {
    const rows = this.db.all<SessionRow>(
      "SELECT * FROM sessions WHERE project_id IS NULL AND (directory = ? OR directory LIKE ? ESCAPE '\\')",
      directory,
      `${directory.replace(/[\\%_]/g, (c) => `\\${c}`)}/.claude/worktrees/%`,
    );
    for (const row of rows) if (this.write(row, { project_id: projectId })) this.changed(row.app_id as AppSessionId, 'facts');
  }

  private set(appId: AppSessionId, values: Record<string, Value>, cause: ChangeCause): SessionRecord {
    return this.db.transaction(() => {
      if (this.write(this.row(appId), values)) this.changed(appId, cause);
      return this.require(appId);
    });
  }

  // A live process's engine id binds its app session. Another record holding that id yields only when it is bare (the
  // record discovery made for the process's own new transcript, seen before the status naming it: removed, its
  // transcript facts moving to this record); another MAWS process's session, or a record carrying the owner's state, is
  // refused. A record already bound to a different id is rebinding (`/clear`): the transcript facts and engine titles
  // it held belong to the old transcript, which stays in the index as a record of its own, and the app session
  // describes the new one once its summary arrives. The engine's custom title noted at a MAWS rename is forgotten: a new
  // transcript's title is not a later terminal rename.
  private bindRow(existing: SessionRow, sessionId: SessionId, cause: ChangeCause): void {
    if (existing.engine_session_id === sessionId) return;
    const other = this.db.get<SessionRow>('SELECT * FROM sessions WHERE engine_session_id = ?', sessionId);
    if (other && !this.bare(other)) throw new Error(`engine session ${sessionId} is already bound to app session ${other.app_id}`);
    if (other) this.deleteRow(toRecord(other));
    const rebinding = existing.engine_session_id !== null;
    const previous = rebinding && existing.summary !== null ? (JSON.parse(existing.summary) as TranscriptSummary) : null;
    const forgotten = {
      transcript_path: null,
      transcript_size: null,
      transcript_mtime_ms: null,
      summary: null,
      title_override_engine_title: null,
      custom_title: null,
      ai_title: null,
      first_prompt: null,
      last_assistant_text: null,
      last_record_at: null,
    };
    this.write(existing, { engine_session_id: sessionId, ...(rebinding ? forgotten : {}) });
    this.changed(existing.app_id as AppSessionId, cause);
    this.bindingChanged(existing.app_id as AppSessionId);
    if (previous !== null) this.upsertFromSummary(previous);
    if (other?.summary) this.upsertFromSummary(JSON.parse(other.summary) as TranscriptSummary);
  }

  // A record discovery made and nobody has touched: no live MAWS process, and none of the owner's own state (pin,
  // archive, a MAWS title, a draft, attention items, a last-seen cursor), so yielding it to the process that writes its transcript loses
  // nothing. Anything else is refused rather than deleted.
  private bare(row: SessionRow): boolean {
    if ((JSON.parse(row.holder) as Holder).kind === 'self') return false;
    if (row.pinned === 1 || row.archived === 1 || row.title_override !== null || row.last_seen_uuid !== null || row.last_seen_at !== null) return false;
    const owned = (table: 'drafts' | 'attention_items') => this.db.get(`SELECT 1 AS present FROM ${table} WHERE app_session_id = ?`, row.app_id) !== null;
    return !owned('drafts') && !owned('attention_items'); // both would go with the row (ON DELETE CASCADE)
  }

  private deleteRow(existing: SessionRecord): void {
    this.db.run('DELETE FROM sessions WHERE app_id = ?', existing.appId);
    this.removed.set(existing.appId, existing);
    this.changed(existing.appId, 'removed');
    this.bindingChanged(existing.appId);
  }

  // Writes the columns that differ from the row (and `updated_at` with them); answers whether anything changed.
  private write(existing: SessionRow, values: Record<string, Value>): boolean {
    const changed: Record<string, Value> = {};
    for (const [key, value] of Object.entries(values)) {
      const stored = existing[key as keyof SessionRow];
      const next = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      if (stored !== next) changed[key] = next;
    }
    if (Object.keys(changed).length === 0) return false;
    this.db.update('sessions', 'app_id', existing.app_id, { ...changed, updated_at: new Date().toISOString() });
    Object.assign(existing, changed);
    return true;
  }

  private row(appId: AppSessionId): SessionRow {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE app_id = ?', appId);
    if (!row) throw new Error(`unknown app session: ${appId}`);
    return row;
  }

  private require(appId: AppSessionId): SessionRecord {
    return toRecord(this.row(appId));
  }

  // One notification per record per transaction, after commit, with the first cause and the record as committed.
  private changed(appId: AppSessionId, cause: ChangeCause): void {
    this.db.defer(`session:${appId}`, () => {
      const record = this.get(appId);
      const gone = this.removed.get(appId);
      this.removed.delete(appId);
      const [notified, notifiedCause] = record ? [record, cause === 'removed' ? 'update' : cause] : [gone, 'removed' as const];
      if (!notified) return;
      const revision = this.stamp();
      for (const listener of this.changeListeners) listener(notified, notifiedCause, revision);
    });
  }

  private bindingChanged(appId: AppSessionId): void {
    this.db.defer(`binding:${appId}`, () => {
      const row = this.db.get<{ engine_session_id: string | null }>('SELECT engine_session_id FROM sessions WHERE app_id = ?', appId);
      const change: BindingChange = { appSessionId: appId, sessionId: (row?.engine_session_id ?? null) as SessionId | null };
      for (const listener of this.bindingListeners) listener(change);
    });
  }
}

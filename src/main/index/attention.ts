// Attention items persisted for main's attention service (C3's, `src/main/attention/service.ts`): `Index.attention`
// implements C3's `AttentionStore` port (`src/main/attention/store.ts`) over the `attention_items` table. The service
// owns the items and their lifecycle; the index only keeps each session's merged list across restarts.
import type { AttentionItem } from '@shared/graph/attention';
import type { AgentId, AppSessionId, AttentionId, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { AttentionStore } from '../attention/store';
import type { Db } from './db';

export type { AttentionStore };

interface AttentionRow {
  id: string;
  app_session_id: string;
  session_id: string | null;
  kind: AttentionItem['kind'];
  request_id: string | null;
  tool_use_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  summary: string;
  created_at: string;
  state: AttentionItem['state'];
  state_changed_at: string;
  expires_at: string | null;
}

const toItem = (row: AttentionRow): AttentionItem => ({
  id: row.id as AttentionId,
  appSessionId: row.app_session_id as AppSessionId,
  sessionId: row.session_id as SessionId | null,
  kind: row.kind,
  request: {
    requestId: row.request_id as RequestId | null,
    toolUseId: row.tool_use_id as ToolUseId | null,
    taskId: row.task_id as TaskId | null,
    agentId: row.agent_id as AgentId | null,
  },
  summary: row.summary,
  createdAt: row.created_at,
  state: row.state,
  stateChangedAt: row.state_changed_at,
  expiresAt: row.expires_at,
});

// The port is asynchronous (C3's file store writes through a rename); SQLite answers at once, so each method resolves
// with the committed result and rejects with the database's error.
export class IndexAttentionStore implements AttentionStore {
  private readonly unrecorded = new Set<AppSessionId>(); // app sessions already logged as having no record

  constructor(private readonly db: Db) {}

  async list(): Promise<AttentionItem[]> {
    return this.db.all<AttentionRow>('SELECT * FROM attention_items ORDER BY created_at, id').map(toItem);
  }

  // The session's whole list, replaced (C3's `attention.changed` semantics). A session the index holds no record of
  // (a launch before its record exists) is not persisted: after a restart nothing would show it, and refusing would
  // have C3's service retry the write every 5 s for as long as the record is missing. Logged once per session.
  async replaceForSession(appId: AppSessionId, items: AttentionItem[]): Promise<void> {
    this.db.transaction(() => {
      if (!this.db.get('SELECT 1 AS present FROM sessions WHERE app_id = ?', appId)) {
        if (!this.unrecorded.has(appId)) console.warn(`[index] attention not persisted: no index record for app session ${appId}`);
        this.unrecorded.add(appId);
        return;
      }
      this.db.run('DELETE FROM attention_items WHERE app_session_id = ?', appId);
      for (const item of items) {
        this.db.insert('attention_items', {
          id: item.id,
          app_session_id: appId,
          session_id: item.sessionId,
          kind: item.kind,
          request_id: item.request.requestId,
          tool_use_id: item.request.toolUseId,
          task_id: item.request.taskId,
          agent_id: item.request.agentId,
          summary: item.summary,
          created_at: item.createdAt,
          state: item.state,
          state_changed_at: item.stateChangedAt,
          expires_at: item.expiresAt,
        });
      }
    });
  }

  async retireForSession(appId: AppSessionId): Promise<void> {
    this.db.transaction(() => void this.db.run('DELETE FROM attention_items WHERE app_session_id = ?', appId));
  }
}

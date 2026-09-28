// Attention items persisted for main's attention service (C3's, `src/main/attention/service.ts`): `Index.attention`
// implements C3's `AttentionStore` port over the `attention_items` table. The service owns the items and their
// lifecycle; the index only keeps each session's merged list across restarts.
import type { AttentionItem } from '@shared/graph/attention';
import type { AgentId, AppSessionId, AttentionId, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { Db } from './db';

// carried from C3 until rebase: C3's port (`src/main/attention/store.ts`), as its document states it.
export interface AttentionStore {
  list(): AttentionItem[];
  replaceForSession(appId: AppSessionId, items: AttentionItem[]): void;
  retireForSession(appId: AppSessionId): void;
}
// end carried from C3

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

export class IndexAttentionStore implements AttentionStore {
  constructor(private readonly db: Db) {}

  list(): AttentionItem[] {
    return this.db.all<AttentionRow>('SELECT * FROM attention_items ORDER BY created_at, id').map(toItem);
  }

  // The session's whole list, replaced (C3's `attention.changed` semantics).
  replaceForSession(appId: AppSessionId, items: AttentionItem[]): void {
    this.db.transaction(() => {
      if (!this.db.get('SELECT 1 AS present FROM sessions WHERE app_id = ?', appId)) throw new Error(`unknown app session: ${appId}`);
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

  retireForSession(appId: AppSessionId): void {
    this.db.transaction(() => void this.db.run('DELETE FROM attention_items WHERE app_session_id = ?', appId));
  }
}

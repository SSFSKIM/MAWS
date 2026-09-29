// The `#panel` harness's two fake sessions (C9 Interfaces *Harness*): A runs in a directory, B in a worktree. The paths
// are fixed so that main (which creates them under MAWS_HARNESS=1, `HARNESS_SESSION_DIRS` in `src/main/window.ts`)
// and this sandboxed page agree without plumbing.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';

export const SESSION_A = 'harness-a' as AppSessionId;
export const SESSION_B = 'harness-b' as AppSessionId;
export const DIR_A = '/tmp/maws-harness/a';
export const DIR_B = '/tmp/maws-harness/b';

function record(appId: AppSessionId, title: string, directory: string, worktree: SessionRecord['worktree']): SessionRecord {
  return {
    appId,
    engineSessionId: null,
    projectId: null,
    directory,
    additionalDirectories: [],
    worktree,
    branch: worktree?.branch ?? null,
    title: { text: title, source: 'user' },
    pinned: false,
    archived: false,
    holder: { kind: 'none' },
    lastSeen: { messageUuid: null, at: null },
    unread: false,
    engineVersion: null,
    gateway: { routed: false },
    model: { requested: null, resolved: null },
    effort: null,
    permissionMode: { requested: 'default', effective: 'default', refusal: null },
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  };
}

export const FAKE_SESSIONS: Record<AppSessionId, SessionRecord> = {
  [SESSION_A]: record(SESSION_A, 'Session A', DIR_A, null),
  [SESSION_B]: record(SESSION_B, 'Session B', DIR_B, { path: DIR_B, branch: 'harness' }),
};

// Source control tool tests (E6): a C4 status to vary per case, and the answers `scm.*` gives. Imported only by
// happy-dom suites.
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { RemotePlan, ScmRefusal } from '@shared/ipc/schema/scm';

export const A = 'app-a' as AppSessionId;
export const B = 'app-b' as AppSessionId;
export const DIR = '/repo';

export function statusOf(over: Partial<GitStatus> = {}): GitStatus {
  return {
    repoRoot: DIR,
    gitDir: `${DIR}/.git`,
    commonDir: `${DIR}/.git`,
    isWorktree: false,
    branch: 'main',
    head: '0123456789abcdef0123456789abcdef01234567',
    upstream: 'origin/main',
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    dirty: true,
    files: [],
    stashCount: 0,
    checkedAt: '2026-10-06T10:00:00.000Z',
    ...over,
  };
}

export const refusal = (refused: ScmRefusal['refused'], detail = '', output = ''): ScmRefusal => ({ refused, detail, output });

export const TOKEN = '6f1c2e0a-0000-4000-8000-000000000001';
export const OTHER_TOKEN = '6f1c2e0a-0000-4000-8000-000000000002';

export function planOf(over: Partial<RemotePlan> = {}): RemotePlan {
  return {
    token: TOKEN,
    kind: 'push',
    cwd: DIR,
    program: '/usr/bin/git',
    argv: ['push', '--progress', 'origin', 'refs/heads/main:refs/heads/main'],
    remote: 'origin',
    remoteUrl: 'https://github.com/o/r.git',
    pushUrls: ['https://github.com/o/r.git'],
    repository: null,
    branch: 'main',
    head: '0123456789abcdef0123456789abcdef01234567',
    upstream: 'origin/main',
    expiresAt: '2026-10-06T10:05:00.000Z',
    ...over,
  };
}

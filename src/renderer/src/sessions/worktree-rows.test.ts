import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SetupIntent } from '@shared/sessions/intent';
import type { WorktreeInfo, WorktreeStatus } from '@shared/sessions/worktree';
import { claimOf, CLAIM_WORDS, worktreeRows, type Claim } from './worktree-rows';

const ROOT = '/private/tmp/maws-c12-repo';
const at = (name: string) => `${ROOT}/.claude/worktrees/${name}`;
const id = (s: string) => s as AppSessionId;

function info(path: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return { repoRoot: ROOT, path, branch: `worktree-${path.split('/').at(-1)}`, head: 'a'.repeat(40), isMain: false, locked: false, prunable: false, managed: true, ...over };
}
const EMPTY = { self: 0, foreign: 0, unbound: 0, idle: 0, archived: 0, idleAppSessionIds: [], liveAppSessionIds: [] };
function status(i: WorktreeInfo, over: Partial<Omit<WorktreeStatus, keyof WorktreeInfo>> = {}): WorktreeStatus {
  return { ...i, dirty: { tracked: 0, untracked: 0 }, occupancy: EMPTY, state: 'clean', ...over };
}
function intent(appSessionId: string, over: Partial<SetupIntent> = {}): SetupIntent {
  return {
    appSessionId: id(appSessionId), projectId: null, createdAt: 't', updatedAt: 't', kind: 'create', source: null,
    location: { kind: 'directory', path: ROOT }, additionalDirectories: [], model: null, effort: null, permissionMode: null,
    gateway: 'gateway', trust: 'unanswered', trustKey: null, message: null, draft: null,
    progress: { engineSessionId: null, worktree: null, trustRecorded: false, bootstrap: null, launch: null, send: null, lastFailure: null },
    ...over,
  };
}
const progressAt = (path: string): SetupIntent['progress'] => ({ ...intent('x').progress, worktree: { path, branch: 'worktree-b', head: 'b'.repeat(40), createdHere: true } });
const rows = (list: WorktreeInfo[], statuses: WorktreeStatus[], claims: Claim[] = []) =>
  worktreeRows(list, new Map(statuses.map((s) => [s.path, s])), claims);

describe('Worktrees… rows', () => {
  const main = info(ROOT, { isMain: true, branch: 'main', managed: false });
  const bound = info(at('bound'));
  const dirty = info(at('dirty'));
  const gone = info(at('gone'), { prunable: true });

  it('lists the main checkout first and never removable, then each linked worktree with its state in C10’s words', () => {
    const r = rows([bound, main, dirty, gone], [
      status(main),
      status(bound, { occupancy: { ...EMPTY, idle: 1, idleAppSessionIds: [id('s-idle')] } }),
      status(dirty, { dirty: { tracked: 2, untracked: 1 }, state: 'dirty' }),
      status(gone),
    ]);
    expect(r.map((x) => [x.name, x.isMain, x.stateLabel, x.removable])).toEqual([
      ['maws-c12-repo', true, 'clean', false],
      ['bound', false, 'clean', true],
      ['dirty', false, 'dirty · 3 changes', true],
      ['gone', false, 'missing', true],
    ]);
    expect(r[1]!.branchLabel).toBe('worktree-bound');
    expect(rows([info(at('d'), { branch: null })], [status(info(at('d'), { branch: null }))])[0]!.branchLabel).toBe('detached');
  });

  it('binds sessions from the occupancy only (live first, then idle), counts terminal holders, and says No session for the orphan', () => {
    const [b, d] = rows([bound, dirty], [
      status(bound, { state: 'busy', occupancy: { ...EMPTY, self: 1, foreign: 1, unbound: 1, idle: 1, liveAppSessionIds: [id('s-live'), id('s-term')], idleAppSessionIds: [id('s-idle')] } }),
      status(dirty, { dirty: { tracked: 1, untracked: 0 }, state: 'dirty' }),
    ]);
    expect(b).toMatchObject({ sessionIds: ['s-live', 's-term', 's-idle'], terminalSessions: 2, noSession: false, stateLabel: 'busy · 3 sessions live here' });
    expect(d).toMatchObject({ sessionIds: [], terminalSessions: 0, noSession: true });
  });

  it('a locked checkout with no process reads busy · locked', () => {
    const locked = info(at('locked'), { locked: true });
    expect(rows([locked], [status(locked, { state: 'busy' })])[0]!.stateLabel).toBe('busy · locked');
  });

  it('a checkout git no longer lists (no status) reads missing', () => {
    expect(worktreeRows([bound], new Map([[bound.path, null]]), [])[0]!.stateLabel).toBe('missing');
  });

  describe('claimed checkouts are busy with the reason and cannot be removed, whatever their status says', () => {
    it('an in-flight setup’s progress.worktree', () => {
      const claims = [{ intent: intent('a', { location: { kind: 'newWorktree', repoRoot: ROOT, name: 'bound', branch: { kind: 'new', name: 'worktree-bound', base: 'HEAD' } }, progress: progressAt(at('bound')) }), starting: true }];
      expect(rows([bound], [status(bound)], claims)[0]).toMatchObject({ state: 'busy', stateLabel: 'busy', claim: CLAIM_WORDS.settingUp, removable: false });
    });

    it('an open unstarted tab whose location is the checkout', () => {
      const claims = [{ intent: intent('b', { location: { kind: 'existingWorktree', repoRoot: ROOT, path: at('dirty') } }), starting: false }];
      expect(rows([dirty], [status(dirty, { dirty: { tracked: 1, untracked: 0 }, state: 'dirty' })], claims)[0]).toMatchObject({ state: 'busy', claim: CLAIM_WORDS.unstartedTab, removable: false });
    });

    it('a retained intent keeping a failed attempt’s checkout', () => {
      const claims = [{ intent: intent('c', { progress: progressAt(at('bound')) }), starting: false }];
      expect(rows([bound], [status(bound)], claims)[0]).toMatchObject({ state: 'busy', claim: CLAIM_WORDS.kept, removable: false });
    });
  });

  it('compares paths as git spells them, normalised (NFC, no trailing separator), in a repository under /private/tmp', () => {
    const nfd = `${ROOT}/.claude/worktrees/café`;
    const claims: Claim[] = [
      { intent: intent('a', { location: { kind: 'existingWorktree', repoRoot: ROOT, path: `${at('bound')}/` } }), starting: false },
      { intent: intent('b', { location: { kind: 'existingWorktree', repoRoot: ROOT, path: nfd } }), starting: false },
    ];
    expect(claimOf(at('bound'), claims)).toBe(CLAIM_WORDS.unstartedTab);
    expect(claimOf(`${ROOT}/.claude/worktrees/café`, claims)).toBe(CLAIM_WORDS.unstartedTab);
    expect(claimOf(at('dirty'), claims)).toBeNull();
    expect(claimOf(ROOT, claims)).toBeNull(); // the main checkout is not claimed by a location in a worktree below it
  });

  it('an in-flight setup outranks an unstarted tab at the same checkout', () => {
    const claims: Claim[] = [
      { intent: intent('a', { location: { kind: 'existingWorktree', repoRoot: ROOT, path: at('bound') } }), starting: false },
      { intent: intent('b', { progress: progressAt(at('bound')) }), starting: true },
    ];
    expect(claimOf(at('bound'), claims)).toBe(CLAIM_WORDS.settingUp);
  });
});

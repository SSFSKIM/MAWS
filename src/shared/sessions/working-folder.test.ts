import { describe, expect, it } from 'vitest';
import { record } from '../../../test/support/builders';
import { SessionRecordSchema, type SessionRecord } from '../graph/session';
import { decodeJsonLine, encodeJsonLine } from '../host/json-bytes';
import { readTolerant } from '../ipc/tolerant';
import { workingBranch, workingFolder, workingWorktree } from './working-folder';

// UX wave U8a (UC-4, first landing): the folder the record names. U8c-2 (§D) keeps every answer for a record that
// carries neither of the two facts but one: `cwd` is the record's directory, where U8a answered the worktree's root.
describe('workingFolder', () => {
  it("answers the record's directory for a session with no worktree", () => {
    expect(workingFolder(record('a', { directory: '/repo', worktree: null }))).toEqual({ path: '/repo', cwd: '/repo', launch: '/repo', moved: false });
  });

  it("answers the worktree's root for a session with a worktree", () => {
    const folder = workingFolder(record('w', { directory: '/repo/.claude/worktrees/w1', worktree: { path: '/repo/.claude/worktrees/w1', branch: 'worktree-w1' } }));
    expect(folder).toEqual({ path: '/repo/.claude/worktrees/w1', cwd: '/repo/.claude/worktrees/w1', launch: '/repo/.claude/worktrees/w1', moved: false });
  });

  // U8c-2, decision 9: the one knowing change for a record without the facts
  it("answers the directory as the agent's folder when the directory lies inside the worktree", () => {
    const folder = workingFolder(record('d', { directory: '/repo/.claude/worktrees/w1/pkg', worktree: { path: '/repo/.claude/worktrees/w1', branch: null } }));
    expect(folder).toEqual({ path: '/repo/.claude/worktrees/w1', cwd: '/repo/.claude/worktrees/w1/pkg', launch: '/repo/.claude/worktrees/w1', moved: false });
  });

  it('answers the empty string for a record whose directory is empty', () => {
    expect(workingFolder(record('e', { directory: '', worktree: null }))).toEqual({ path: '', cwd: '', launch: '', moved: false });
  });

  it('reads only the directory, the worktree and the two facts', () => {
    expect(workingFolder({ directory: '/repo', worktree: null }).path).toBe('/repo');
  });
});

// U8c-2 (§D): the two facts the index writes beside build F's fields, each overriding only where it is present.
describe('the two facts', () => {
  const w1 = '/repo/.claude/worktrees/w1';
  const plain = record('p', { directory: '/repo', worktree: null, branch: 'main' });
  // a `cd` into a linked worktree: filed at the launch checkout, the agent elsewhere
  const byCd = record('c', { directory: '/repo', worktree: null, branch: 'main', agentFolder: { checkout: w1, cwd: `${w1}/src`, branch: 'w1', linked: true } });
  // the tool: filed in the worktree, launched at the checkout
  const byTool = record('t', { directory: `${w1}/src`, worktree: { path: w1, branch: 'worktree-w1' }, branch: 'worktree-w1', launchFolder: '/repo' });
  // both: filed in a worktree by the tool, the agent back in the launch checkout's own work tree by `cd`
  const both = record('b', { directory: w1, worktree: { path: w1, branch: 'worktree-w1' }, branch: 'worktree-w1', launchFolder: '/repo', agentFolder: { checkout: '/repo', cwd: '/repo/docs', branch: 'main', linked: false } });

  it('answers the four fields from neither, either and both', () => {
    expect(workingFolder(plain)).toEqual({ path: '/repo', cwd: '/repo', launch: '/repo', moved: false });
    expect(workingFolder(byCd)).toEqual({ path: w1, cwd: `${w1}/src`, launch: '/repo', moved: true });
    expect(workingFolder(byTool)).toEqual({ path: w1, cwd: `${w1}/src`, launch: '/repo', moved: true });
    expect(workingFolder(both)).toEqual({ path: '/repo', cwd: '/repo/docs', launch: '/repo', moved: false });
  });

  it('names the linked worktree the agent is working in, or none', () => {
    expect(workingWorktree(plain)).toBeNull();
    expect(workingWorktree(record('l', { directory: w1, worktree: { path: w1, branch: 'worktree-w1' } }))).toEqual({ path: w1, branch: 'worktree-w1' });
    expect(workingWorktree(byCd)).toEqual({ path: w1, branch: 'w1' });
    expect(workingWorktree(byTool)).toEqual({ path: w1, branch: 'worktree-w1' });
    expect(workingWorktree(both)).toBeNull(); // the agent is in the main checkout
  });

  it("names the working folder's branch, `HEAD` and empty being none", () => {
    expect(workingBranch(plain)).toBe('main');
    expect(workingBranch(record('h', { directory: '/repo', worktree: null, branch: 'HEAD' }))).toBeNull();
    expect(workingBranch(record('w', { directory: w1, worktree: { path: w1, branch: null }, branch: 'stale' }))).toBe('stale');
    expect(workingBranch(byCd)).toBe('w1');
    expect(workingBranch(byTool)).toBe('worktree-w1');
    expect(workingBranch(both)).toBe('main');
    expect(workingBranch({ ...byCd, agentFolder: { ...byCd.agentFolder!, branch: null } })).toBeNull(); // not the record's branch
  });

  // B-3: the two pairings a unit test can hold (§C)
  it('crosses the link whole, and a reader that does not know the facts answers the filed folder', () => {
    const sent: [SessionRecord, string][] = [
      [byCd, '/repo'],
      [byTool, w1],
      [both, w1],
    ];
    for (const [record] of sent) {
      const received = SessionRecordSchema.parse(decodeJsonLine(encodeJsonLine(record)));
      expect(received).toEqual(record);
      expect(workingFolder(received)).toEqual(workingFolder(record));
    }
    const buildF = SessionRecordSchema.omit({ launchFolder: true, agentFolder: true });
    for (const [record, filed] of sent) {
      const read = readTolerant(buildF, record);
      expect(read.ok).toBe(true);
      if (!read.ok) continue;
      expect(Object.keys(read.value)).not.toContain('agentFolder');
      expect(Object.keys(read.value)).not.toContain('launchFolder');
      expect(workingFolder(read.value as SessionRecord)).toEqual({ path: filed, cwd: record.directory, launch: filed, moved: false });
    }
  });
});

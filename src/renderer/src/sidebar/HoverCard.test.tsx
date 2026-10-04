import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ProjectId, RequestId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { item } from '../../../../test/support/builders';
import { ev } from '../../../../test/support/events';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useAttention } from '../stores/attention';
import { useSessions } from '../stores/sessions';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { formatAge, projectList } from './derive';
import { RequestPreview } from './RequestPreview';
import { useLayout } from '../stores/layout';
import { Sidebar } from './Sidebar';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
// The scenario's 3 s entry: the synthetic read-only request for Charter + research.
const readOp = nine.timeline.find((op) => op.op === 'attention')! as Extract<(typeof nine.timeline)[number], { op: 'attention' }>;
const requests: Record<string, SessionEvent> = Object.assign({}, ...nine.attention.map((a) => a.requests), readOp.requests);

let fake: FakeClient;
function withMain(outcome: 'delivered' | 'not_pending' = 'delivered') {
  fake = fakeClient({
    'attention.request': ({ requestId }: { requestId: string }) => ({ event: requests[requestId] ?? null }),
    'session.answer': () => ({ outcome }),
  });
  window.maws = fake.client;
}

// W5: the card sits on every session row; both requests' sessions are on MAWS's page.
const needsRow = (title: string) => screen.getByRole('treeitem', { name: title });

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  useLayout.getState().setSidebar({ expandedProjects: ['proj-maws' as ProjectId] });
  act(() => useAttention.getState().applyChanged({ appSessionId: readOp.appSessionId, items: readOp.items }));
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

describe.each(['tree', 'Needs you'] as const)('%s hover card approves read-only only', (placement) => {
  const needsRow = (title: string) => placement === 'tree'
    ? screen.getByRole('treeitem', { name: title })
    : within(screen.getByRole('list', { name: 'Needs you' })).getByRole('button', { name: new RegExp(title.replace('+', '\\+')) });
  it('previews the Bash request with its command and cwd, offers Open session and no Approve', async () => {
    withMain();
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.hover(needsRow('Fix sidebar drag'));
    const card = await screen.findByRole('dialog', { name: 'Fix sidebar drag' });
    expect(await within(card).findByText('git log --oneline')).toBeTruthy();
    expect(within(card).getByText('Bash')).toBeTruthy();
    expect(within(card).getByText('/private/tmp/maws-probe-qqboLh')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Open session' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Deny' })).toBeNull();
    expect(fake.invoked('attention.request')).toHaveLength(1);
  });

  it('offers Approve and Deny for the read-only request, and Approve answers allow once', async () => {
    withMain();
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.hover(needsRow('Charter + research'));
    const card = await screen.findByRole('dialog', { name: 'Charter + research' });
    const approve = await within(card).findByRole('button', { name: 'Approve' });
    expect(within(card).getByRole('button', { name: 'Deny' })).toBeTruthy();
    await user.click(approve);
    expect(fake.invoked('session.answer')).toEqual([
      { appSessionId: idOf('Charter + research'), requestId: 'req-synthetic-read-9a1d4262', answer: { kind: 'permission', decision: 'allow', scope: 'once' } },
    ]);
  });

  it('Enter or Space on a focused Approve or Deny answers nothing; only a pointer click does', async () => {
    withMain();
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.hover(needsRow('Charter + research'));
    const card = await screen.findByRole('dialog', { name: 'Charter + research' });
    const approve = await within(card).findByRole('button', { name: 'Approve' });
    const deny = within(card).getByRole('button', { name: 'Deny' });
    for (const button of [approve, deny]) {
      button.focus();
      expect(document.activeElement).toBe(button); // still focusable and labelled
      await user.keyboard('{Enter}');
      await user.keyboard(' ');
    }
    expect(fake.invoked('session.answer')).toEqual([]);
    expect(useAttention.getState().bySession.get(readOp.appSessionId)).toEqual(readOp.items); // still pending
    await user.click(approve);
    expect(fake.invoked('session.answer')).toHaveLength(1);
  });

  it('a synthetic click with no pointer press before it answers nothing', async () => {
    withMain();
    render(<RequestPreview item={readOp.items[0]} request={requests['req-synthetic-read-9a1d4262']} placement="hover" paneIndex={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }), { detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }), { detail: 0 });
    expect(fake.invoked('session.answer')).toEqual([]);
  });

  it('Enter on the focused row answers nothing', async () => {
    withMain();
    const user = userEvent.setup();
    render(<Sidebar />);
    needsRow('Charter + research').focus();
    await screen.findByRole('dialog', { name: 'Charter + research' });
    await user.keyboard('{Enter}');
    expect(fake.invoked('session.answer')).toEqual([]);
  });

  it('shows "Not delivered" when the answer comes back other than delivered', async () => {
    withMain('not_pending');
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.hover(needsRow('Charter + research'));
    const card = await screen.findByRole('dialog', { name: 'Charter + research' });
    await user.click(await within(card).findByRole('button', { name: 'Approve' }));
    expect(await within(card).findByText('Not delivered')).toBeTruthy();
  });
});

// W5 (D2): what the one-line row leaves out, in the card: status, age and context, branch and worktree, the holder or
// the activity, the last answer.
describe('a session row’s hover card', () => {
  const open = async (title: string) => {
    await userEvent.setup().hover(needsRow(title));
    return screen.findByRole('dialog', { name: title });
  };

  it('a working session: its status, age and context, its activity and its last answer', async () => {
    withMain();
    useLayout.getState().setSidebar({ expandedProjects: ['proj-claude-usage-menubar' as ProjectId] });
    const digest = useSessions.getState().digests.get(idOf('Usage reset countdown'))!;
    act(() => useSessions.getState().applyDigest({ ...digest, context: { percent: 41.4, totalTokens: 414_000, maxTokens: 1_000_000, autoCompactThreshold: null }, revision: digest.revision + 1 }));
    render(<Sidebar />);
    const card = await open('Usage reset countdown');
    expect(within(card).getByRole('heading', { name: 'Usage reset countdown' })).toBeTruthy();
    expect(within(card).getByTestId('hover-meta').textContent).toBe('Working · now · ctx 41%');
    expect(within(card).getByTestId('hover-activity').textContent).toBe('Running curl -sI https://example.com | head -1');
    expect(within(card).getByTestId('hover-answer').textContent).toMatch(/^The request succeeded/);
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull(); // nothing waits
  });

  it('a foreign-live session names its holder', async () => {
    withMain();
    useLayout.getState().setSidebar({ expandedProjects: ['proj-codex-somersault' as ProjectId] });
    render(<Sidebar />);
    const card = await open('Somersault terminal run');
    expect(within(card).getByTestId('hover-activity').textContent).toBe('Terminal · pid 7135');
    expect(within(card).getByTestId('hover-meta').textContent).toMatch(/^Live in terminal · /);
  });

  it('a worktree session names its branch and the worktree’s folder; a main session its branch', async () => {
    withMain();
    const charter = idOf('Charter + research');
    const drag = idOf('Fix sidebar drag');
    act(() =>
      fillStores({
        ...nine,
        sessions: nine.sessions.map((r) =>
          r.appId === charter
            ? { ...r, worktree: { path: '/Users/new/Developer/GitHub/MAWS-sibling', branch: 'feature/sibling' } }
            : r.appId === drag
              ? { ...r, branch: 'master' }
              : r,
        ),
      }),
    );
    render(<Sidebar />);
    const sibling = await open('Charter + research');
    const place = within(sibling).getByTestId('hover-place');
    expect(place.textContent).toBe('⎇ feature/sibling · worktree MAWS-sibling');
    expect(place.getAttribute('title')).toBe('/Users/new/Developer/GitHub/MAWS-sibling');
    await userEvent.setup().unhover(needsRow('Charter + research'));
    const main = await open('Fix sidebar drag');
    expect(within(main).getByTestId('hover-place').textContent).toBe('⎇ master');
  });
});

// W11 (I6): a project row's card, in the same shell: the name, the path home-abbreviated, the counts, the last activity
// and the worktrees git lists, read when the card opens and never before.
describe('a project’s hover card', () => {
  const projectLine = (name: string) => screen.getByRole('treeitem', { name }).querySelector<HTMLElement>('[data-project-line]')!;
  const info = (path: string, branch: string | null, isMain = false) => ({ repoRoot: '/Users/new/Developer/GitHub/MAWS', path, branch, head: 'abc', isMain, locked: false, prunable: false, managed: path.includes('/.claude/') });

  it('names the project, its path, its counts and last activity, and lists its worktrees read on open', async () => {
    fake = fakeClient({
      'git.worktree.list': {
        repoRoot: '/Users/new/Developer/GitHub/MAWS',
        commonDir: '/Users/new/Developer/GitHub/MAWS/.git',
        worktrees: [info('/Users/new/Developer/GitHub/MAWS', 'master', true), info('/Users/new/Developer/GitHub/MAWS/.claude/worktrees/accept-one', 'worktree-accept-one')],
      },
    });
    window.maws = fake.client;
    useLayout.getState().setSidebar({ expandedProjects: [] });
    render(<Sidebar />);
    expect(fake.invoked('git.worktree.list')).toEqual([]); // nothing read while closed
    await userEvent.setup().hover(projectLine('MAWS'));
    const card = await screen.findByRole('dialog', { name: 'MAWS' });
    const maws = nine.projects.find((p) => p.id === 'proj-maws')!;
    expect(within(card).getByRole('heading', { name: 'MAWS' })).toBeTruthy();
    expect(within(card).getByTestId('project-path').textContent).toBe(maws.directory.replace(/^\/Users\/[^/]+/, '~'));
    expect(within(card).getByTestId('project-path').getAttribute('title')).toBe(maws.directory);
    expect(within(card).getByTestId('project-counts').textContent).toBe('4 sessions · 3 waiting · 1 working'); // the 3 s request included
    const s = useSessions.getState();
    const last = projectList({ records: s.records, digests: s.digests, projects: [...s.projects.values()], rows: [] }).find((e) => e.key === 'proj-maws')!.lastActivity!;
    const age = formatAge(Date.now() - last);
    expect(within(card).getByTestId('project-activity').textContent).toBe(age === 'now' ? 'Active now' : `Last active ${age} ago`);
    const worktrees = await within(card).findByRole('list', { name: 'Worktrees' });
    expect(within(worktrees).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['⎇ mastermain checkout', '⎇ worktree-accept-oneaccept-one']);
    expect(fake.invoked('git.worktree.list')).toEqual([{ repoRoot: maws.directory }]);
  });

  it('opens on the project row’s keyboard focus, says nothing of worktrees outside a repository, and Other sessions has none', async () => {
    fake = fakeClient();
    window.maws = fake.client;
    render(<Sidebar />);
    act(() => screen.getByRole('treeitem', { name: 'codex_somersault' }).focus());
    const card = await screen.findByRole('dialog', { name: 'codex_somersault' });
    expect(within(card).getByTestId('project-counts').textContent).toBe('3 sessions · 1 waiting · 0 working');
    expect(within(card).getByText('Reading…')).toBeTruthy();
    await act(() => fake.fail('git.worktree.list', 'not a repository'));
    expect(within(card).queryByText('Reading…')).toBeNull();
    expect(within(card).queryByRole('list', { name: 'Worktrees' })).toBeNull();
    act(() => screen.getByRole('treeitem', { name: 'codex_somersault' }).blur());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'codex_somersault' })).toBeNull());
    act(() => screen.getByRole('treeitem', { name: 'Other sessions' }).focus());
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.queryByRole('dialog', { name: 'Other sessions' })).toBeNull();
  });
});

describe('request preview', () => {
  const at = '2026-09-28T10:00:00.000Z';
  const itemFor = (id: string, kind: AttentionItem['kind'], requestId: string) =>
    item(id, kind, at, { request: { requestId: requestId as RequestId, toolUseId: null, taskId: null, agentId: null } });

  it('Deny sends a plain deny with no scope', async () => {
    withMain();
    const request = requests['req-synthetic-read-9a1d4262'];
    render(<RequestPreview item={readOp.items[0]} request={request} placement="hover" paneIndex={null} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Deny' }));
    expect(fake.invoked('session.answer')).toEqual([
      { appSessionId: idOf('Charter + research'), requestId: 'req-synthetic-read-9a1d4262', answer: { kind: 'permission', decision: 'deny' } },
    ]);
  });

  it('never offers Approve outside the hover placement', () => {
    render(<RequestPreview item={readOp.items[0]} request={requests['req-synthetic-read-9a1d4262']} placement="card" paneIndex={null} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open session' })).toBeTruthy();
  });

  it('shows a question’s headers and options', () => {
    const q = nine.attention.find((a) => a.appSessionId === idOf('Sidebar interaction pass'))!;
    render(<RequestPreview item={q.items[0]} request={Object.values(q.requests)[0]} placement="hover" paneIndex={null} />);
    expect(screen.getByText('Color')).toBeTruthy();
    expect(screen.getByText('Which color do you prefer?')).toBeTruthy();
    expect(screen.getByText('Red')).toBeTruthy();
    expect(screen.getByText('Pear')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('shows the first six lines of a plan', () => {
    const plan = ev('plan.requested', {
      requestId: 'r1', toolUseId: 'toolu_1', plan: ['# Plan', '1. one', '2. two', '3. three', '4. four', '5. five', '6. six'].join('\n'), input: {},
    });
    render(<RequestPreview item={itemFor('a1', 'plan', 'r1')} request={plan} placement="hover" paneIndex={null} />);
    const preview = screen.getByTestId('request-input');
    expect(preview.textContent).toContain('5. five');
    expect(preview.textContent).not.toContain('6. six');
  });

  it('shows the path of a file tool, pretty JSON for others, and the requesting agent', () => {
    const edit = ev('permission.requested', { toolName: 'Edit', input: { file_path: '/r/src/app.ts', old_string: 'a', new_string: 'b' }, agentId: 'agent-7' });
    const { unmount } = render(<RequestPreview item={itemFor('a1', 'permission', 'req_1')} request={edit} placement="hover" paneIndex={null} />);
    expect(screen.getByTestId('request-input').textContent).toBe('/r/src/app.ts');
    expect(screen.getByText('from agent agent-7')).toBeTruthy();
    unmount();
    const mcp = ev('permission.requested', { toolName: 'mcp__x__y', input: { a: 1 } });
    render(<RequestPreview item={itemFor('a1', 'permission', 'req_1')} request={mcp} placement="hover" paneIndex={null} />);
    expect(screen.getByTestId('request-input').textContent).toBe('{\n  "a": 1\n}');
  });

  it('shows the item’s summary while the request is not known', () => {
    render(<RequestPreview item={item('a1', 'interrupted', at, { summary: 'Session interrupted, 1 approval lost' })} request={null} placement="hover" paneIndex={null} />);
    expect(screen.getByText('Session interrupted, 1 approval lost')).toBeTruthy();
  });

  it('never offers Approve for a foreign-live session', () => {
    const foreign = idOf('Somersault terminal run');
    const read = ev('permission.requested', { toolName: 'Read', input: { file_path: '/r/a.md' } });
    render(<RequestPreview item={itemFor(foreign as AppSessionId, 'permission', 'req_1')} request={read} placement="hover" paneIndex={null} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }));
  });
});

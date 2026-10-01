import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { item } from '../../../../test/support/builders';
import { ev } from '../../../../test/support/events';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useAttention } from '../stores/attention';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { RequestPreview } from './RequestPreview';
import { waitingItem } from '../attention/derive';
import { HoverCard } from './HoverCard';

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

// The card on a trigger of its own: the Needs-you rows it sat on are gone (W5), and W5's item 2 puts it on every session row.
function Rows() {
  return ['Fix sidebar drag', 'Charter + research'].map((title) => <Row key={title} title={title} />);
}
function Row({ title }: { title: string }) {
  const items = useAttention((s) => s.bySession.get(idOf(title)) ?? []);
  const waiting = waitingItem(items);
  if (!waiting) return null;
  return (
    <HoverCard item={waiting.oldest} title={title}>
      <button type="button">{title}</button>
    </HoverCard>
  );
}
const needsRow = (title: string) => screen.getByRole('button', { name: title });

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  act(() => useAttention.getState().applyChanged({ appSessionId: readOp.appSessionId, items: readOp.items }));
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

describe('hover card approves read-only only', () => {
  it('previews the Bash request with its command and cwd, offers Open session and no Approve', async () => {
    withMain();
    const user = userEvent.setup();
    render(<Rows />);
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
    render(<Rows />);
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
    render(<Rows />);
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
    render(<Rows />);
    needsRow('Charter + research').focus();
    await screen.findByRole('dialog', { name: 'Charter + research' });
    await user.keyboard('{Enter}');
    expect(fake.invoked('session.answer')).toEqual([]);
  });

  it('shows "Not delivered" when the answer comes back other than delivered', async () => {
    withMain('not_pending');
    const user = userEvent.setup();
    render(<Rows />);
    await user.hover(needsRow('Charter + research'));
    const card = await screen.findByRole('dialog', { name: 'Charter + research' });
    await user.click(await within(card).findByRole('button', { name: 'Approve' }));
    expect(await within(card).findByText('Not delivered')).toBeTruthy();
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

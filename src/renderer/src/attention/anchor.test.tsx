// P2-C (M6): the owner channel's two kinds on the attention surfaces. A question an agent left or a must-read opens at
// its mark: the session in the focused pane, the report view, the jump to the text its anchor names once the tab's
// transcript has its history (a notification's click, ⌘⇧J, the Needs-you row, the Overview card's Open session). The
// Needs-you row reads the item's summary; the Overview card offers Mark read for a must-read and answers nothing; the
// composer neither docks nor shows a notice for either.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import { markIdOf } from '@shared/owner/marks';
import { fakeClient } from '../../../../test/support/fake-client';
import { item } from '../../../../test/support/builders';
import { swapOf } from '../composer/docked/swap';
import { RequestCard } from '../request-card/RequestCard';
import { Sidebar } from '../sidebar/Sidebar';
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useTranscriptStore } from '../stores/transcript';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { BASH_RESULT, builder, uuid } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
import { openAnchor } from './anchor';
import { connectAttention } from './navigation';

const nine = scenarioFile('nine-sessions');
const APP = nine.sessions.find((r) => r.title.text === 'Charter + research')!.appId as AppSessionId;
const active = () => activeTab(useLayout.getState().main);
const anchor = { messageUuid: uuid('m2-u0'), blockIndex: 0, span: 0 };
const NONE = { requestId: null, toolUseId: null, taskId: null, agentId: null };
const owner = (kind: 'async_input' | 'essential_unread', summary: string, at = '2026-09-28T08:00:00.000Z'): AttentionItem =>
  item(APP, kind, at, { id: `${APP}:${kind}:x` as AttentionId, request: NONE, summary, anchor });

// A marked turn whose question sits in an unmarked turn's working record, so the jump has something to open.
function history(): SessionEvent[] {
  const b = builder();
  b.turn('u1');
  b.text('m1', 0, 'Looking.');
  b.toolUse('t1', 'Bash', { command: 'ls' });
  b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
  b.text('m2', 0, '<need-input>Which backend?\n<choice>Postgres</choice>\n</need-input>');
  b.end(['u1']);
  return b.events;
}
// A source whose snapshot answers when the test says, as a tab's history arrives after the tab mounts.
function laterSource(events: SessionEvent[]) {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  const source: TranscriptSource = { subscribe: () => () => {}, snapshot: () => ready.then(() => events) };
  return { source, release };
}

let fake: ReturnType<typeof fakeClient>;
let disconnect: () => void;
beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  fake = fakeClient({ 'attention.pendingNavigate': { navigate: null }, 'attention.request': () => ({ event: null }), 'ownerChannel.markRead': undefined });
  window.maws = fake.client;
  disconnect = connectAttention(fake.client);
});
afterEach(() => {
  cleanup();
  disconnect();
  useTranscriptStore.getState().drop(APP);
});

describe('opening an owner-channel item at its mark', () => {
  it('opens the tab, waits for its history, then shows the report and jumps to the anchored text (opening its record)', async () => {
    const later = laterSource(history());
    const attached = useTranscriptStore.getState().attach(APP, later.source);
    useTranscriptStore.getState().setOwnerLane(APP, true);
    useTranscriptStore.getState().setView(APP, 'transcript'); // the reader had chosen the full transcript
    openAnchor(APP, anchor);
    expect(active()).toMatchObject({ kind: 'session', appSessionId: APP });
    expect(useTranscriptStore.getState().entries[APP]!.jump).toBeNull(); // still hydrating: nothing to jump to
    later.release();
    await act(() => attached);
    const entry = useTranscriptStore.getState().entries[APP]!;
    expect(entry.state.ui.view).toBe('report');
    expect(entry.jump).toMatchObject({ rowId: expect.stringContaining('m2') });
  });

  it('a notification’s click on an owner item opens it at its mark', async () => {
    await useTranscriptStore.getState().attach(APP, laterSourceNow(history()));
    useTranscriptStore.getState().setOwnerLane(APP, true);
    const question = owner('async_input', 'Question — Which backend?');
    act(() => useAttention.getState().applyChanged({ appSessionId: APP, items: [question] }));
    fake.event('attention.navigate', { appSessionId: APP, attentionId: question.id, source: 'notification' });
    expect(active()).toMatchObject({ appSessionId: APP });
    expect(useTranscriptStore.getState().entries[APP]!.jump).toMatchObject({ rowId: expect.stringContaining('m2') });
  });
});

const laterSourceNow = (events: SessionEvent[]): TranscriptSource => ({ subscribe: () => () => {}, snapshot: () => Promise.resolve(events) });

describe('the surfaces', () => {
  it('the Needs-you row reads the item’s summary and opens at its mark', async () => {
    await useTranscriptStore.getState().attach(APP, laterSourceNow(history()));
    useTranscriptStore.getState().setOwnerLane(APP, true);
    act(() => useAttention.getState().applyChanged({ appSessionId: APP, items: [owner('essential_unread', 'Must read — The README is unverified.')] }));
    render(<Sidebar />);
    const row = within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('button').find((b) => b.dataset.needsYou === APP)!;
    expect(row.textContent).toContain('Must read — The README is unverified.');
    fireEvent.click(row);
    expect(active()).toMatchObject({ appSessionId: APP });
    expect(useTranscriptStore.getState().entries[APP]!.jump).toMatchObject({ rowId: expect.stringContaining('m2') });
  });

  it('the Overview card offers Mark read for a must-read, and nothing to answer for a question', () => {
    const must = owner('essential_unread', 'Must read — Mind the migration.');
    render(<RequestCard item={must} request={null} placement="card" paneIndex={0} />);
    expect(screen.getByText('Must read — Mind the migration.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    expect(fake.invoked('ownerChannel.markRead')).toEqual([{ appSessionId: APP, markIds: [markIdOf(APP, 'essential', anchor)] }]);
    cleanup();
    render(<RequestCard item={owner('async_input', 'Question — Which backend?')} request={null} placement="card" paneIndex={0} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Open session']);
  });

  it('the composer neither docks nor shows a notice for either kind', () => {
    const items = [owner('async_input', 'Question — Which backend?'), owner('essential_unread', 'Must read — x', '2026-09-28T08:01:00.000Z')];
    expect(swapOf(items, new Map())).toEqual({ item: null, notice: null, waiting: 0, unread: [] });
  });
});

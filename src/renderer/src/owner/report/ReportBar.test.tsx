import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { OwnerMark } from '@shared/owner/state';
import { resetOwnerChannelStore, useOwnerChannelStore } from '../../stores/owner-channel';
import { useTranscriptStore } from '../../stores/transcript';
import { ReportBar } from './ReportBar';

const APP = 'single-unread' as AppSessionId;
afterEach(() => { cleanup(); resetOwnerChannelStore(); useTranscriptStore.setState({ entries: {} }); });
it.each([{ count: 1, kind: 'essential' }, { count: 2, kind: 'essential' }, { count: 1, kind: 'need-input' }, { count: 2, kind: 'need-input' }])('keeps $count $kind marks clearable without transcript cards', ({ count, kind }) => {
  const marks = Array.from({ length: count }, (_, i) => ({ id: `mark-${i}`, kind, anchor: { messageUuid: `m-${i}`, blockIndex: 0, span: 0 }, head: 'Keep a backup.', at: '2026-10-24T00:00:00.000Z', item: true, ...(kind === 'essential' ? { essential: { state: 'unread', readAt: null } } : { question: { state: 'unanswered' } }) }) as OwnerMark);
  useOwnerChannelStore.setState({ bySession: new Map([[APP, { appSessionId: APP, lane: { on: true, override: 'on', applied: 'maws-contract', pending: null, mismatch: null }, marks }]]) });
  useTranscriptStore.setState({ entries: { [APP]: { state: { ui: { ownerLane: true } } } } as never });
  const markRead = vi.fn();
  render(<ReportBar appSessionId={APP} markAllRead={markRead} />);
  fireEvent.click(screen.getByRole('button', { name: count === 1 ? 'Mark read' : 'Mark all read' }));
  expect(markRead).toHaveBeenCalledOnce();
});

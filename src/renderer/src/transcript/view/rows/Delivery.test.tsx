// E2 (M5, Design §9; P3-L M6b): a delivered file's name opens its File artifact through `openArtifact` once the host
// recorded it (the file has a deliverable id, the artifact's); a file still pending, or a refused call's, stays text. Open externally and
// Reveal in Finder stay as E1 built them (maws.test.tsx).
import type { AppSessionId } from '@shared/graph/ids';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { addressOf } from '@shared/machine/address';
import { loadJournal } from '../../../../../../test/support/fixtures';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { applyRemoteSession, resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { remoteSessionState } from '../../../lane-b/test-support/remote-session';
import { useMachines } from '../../../stores/machines';
import { useTranscriptStore } from '../../../stores/transcript';
import { journalToEvents } from '../../dev/journal';
import type { Row } from '../../model/rows';
import { renderRow, rowOf, storeWith } from './test-support';

afterEach(() => {
  cleanup();
  resetRemoteLaneBStore();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

type DeliveryRow = Extract<Row, { kind: 'delivery' }>;

const APP = 'app-maws' as AppSessionId;
const ROW: DeliveryRow = {
  id: 'delivery:t1' as never, turnId: null, at: '2026-10-06T00:00:00.000Z', kind: 'delivery', toolUseId: 't1' as never,
  files: [{ path: '/repo/a.txt', name: 'a.txt', id: 'd-1' }, { path: '/repo/b.md', name: 'b.md', id: 'd-2' }], caption: null, urgency: 'normal', error: null,
};

describe('the delivery row’s file names', () => {
  it('p1-maws-send-file: the name is a button that opens the recorded file in the viewer, its path as the title', async () => {
    const store = await storeWith(journalToEvents(loadJournal('pass3', 'p1-maws-send-file')));
    useTranscriptStore.getState().expandAll(store.key);
    const { actions } = renderRow(rowOf(store.rows(), 'delivery'), { storeKey: APP });
    const name = screen.getByRole('button', { name: 'hello.txt' });
    expect(name.getAttribute('title')).toBe('/private/tmp/maws-e1-repo-G8SYJD/hello.txt');
    fireEvent.click(name);
    expect(actions.openArtifact).toHaveBeenCalledExactlyOnceWith(APP, 'd7649bfe-f476-44bc-b238-10c5c7ab4aa2');
  });

  it('each name opens its own record', () => {
    const { actions } = renderRow(ROW, { storeKey: APP });
    fireEvent.click(screen.getByRole('button', { name: 'b.md' }));
    expect(actions.openArtifact).toHaveBeenCalledExactlyOnceWith(APP, 'd-2');
  });

  it('a pending file (no id yet) and a refused call’s file stay text: clicking the name does nothing', () => {
    const pending = renderRow({ ...ROW, files: [{ path: 'a.txt', name: 'a.txt', id: null }] }, { storeKey: APP });
    expect(screen.queryByRole('button', { name: 'a.txt' })).toBeNull();
    fireEvent.click(screen.getByText('a.txt'));
    expect(pending.actions.openArtifact).not.toHaveBeenCalled();
    pending.unmount();
    const refused = renderRow({ ...ROW, files: [{ path: 'a.txt', name: 'a.txt', id: null }], error: 'send_file: not a file: /repo/a.txt' }, { storeKey: APP });
    expect(refused.container.querySelectorAll('button')).toHaveLength(0);
  });

  it('outside a mounted transcript the name is disabled', () => {
    const { actions } = renderRow(ROW);
    const name = screen.getByRole<HTMLButtonElement>('button', { name: 'a.txt' });
    expect(name.disabled).toBe(true);
    fireEvent.click(name);
    expect(actions.openArtifact).not.toHaveBeenCalled();
  });
});

// P5 O7 M4: on a lane B session on another machine, Open externally and Reveal in Finder would act on that machine's
// desktop: they stay greyed, saying where the file is, until M5 routes them.
describe('a delivery on another machine’s session', () => {
  it('greys Open externally and Reveal in Finder with “on <machine>”, and asks nothing', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
    ]);
    applyRemoteSession(remoteSessionState(REMOTE));
    const { actions } = renderRow({ ...ROW, files: [{ path: '/repo/report.pdf', name: 'report.pdf', id: 'd-1' }] }, { storeKey: REMOTE });
    const open = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally: report.pdf' });
    const reveal = screen.getByRole<HTMLButtonElement>('button', { name: 'Reveal in Finder: report.pdf' });
    expect([open.disabled, reveal.disabled]).toEqual([true, true]);
    expect(reveal.title).toBe('This file is on mini, not on this Mac');
    expect(screen.getByText('on mini')).toBeTruthy();
    fireEvent.click(open);
    fireEvent.click(reveal);
    expect(actions.openDelivered).not.toHaveBeenCalled();
    expect(actions.revealDelivered).not.toHaveBeenCalled();
  });
});

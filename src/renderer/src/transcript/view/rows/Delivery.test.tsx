// E2 (M5, Design §9; P3-L M6b): a delivered file's name opens its File artifact through `openArtifact` once the host
// recorded it (the file has a deliverable id, the artifact's); a file still pending, or a refused call's, stays text. Open externally and
// Reveal in Finder stay as E1 built them (maws.test.tsx).
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
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
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import { leaveRl2, overRl2 } from '../../../test-support/code-disk'; // ticket 627
import { accessibleDescription } from '../../../test-support/accessible-text'; // ticket 815

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
  it('p1-maws-send-file: the name is a button that opens the recorded file in the viewer, its path as the tip', async () => {
    const store = await storeWith(journalToEvents(loadJournal('pass3', 'p1-maws-send-file')));
    useTranscriptStore.getState().expandAll(store.key);
    const { actions } = renderRow(rowOf(store.rows(), 'delivery'), { storeKey: APP });
    const name = screen.getByRole('button', { name: 'hello.txt' });
    expect(accessibleDescription(name)).toBe('/private/tmp/maws-e1-repo-G8SYJD/hello.txt'); // ticket 815
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
    fireEvent.click(screen.getByText('a.txt', { selector: '.transcript-delivery-name' }));
    expect(pending.actions.openArtifact).not.toHaveBeenCalled();
    pending.unmount();
    const refused = renderRow({ ...ROW, files: [{ path: 'a.txt', name: 'a.txt', id: null }], error: 'send_file: not a file: /repo/a.txt' }, { storeKey: APP });
    expect(refused.container.querySelectorAll('button')).toHaveLength(0);
  });

  it('draws Open externally and Reveal in Finder on pointing or focus within the file’s line, the name the press (the word cut, T101)', () => {
    const { container } = renderRow(ROW, { storeKey: APP });
    const lines = [...container.querySelectorAll('.transcript-delivery-file')];
    expect(lines.map((line) => line.querySelector('.transcript-delivery-actions')?.hasAttribute('data-on-hover'))).toEqual([true, true]);
    expect(screen.getByRole('button', { name: 'Reveal in Finder: a.txt' }).closest('.transcript-delivery-file')).toBe(lines[0]);
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
// desktop. P5 O7 M5a (A10): Open externally opens a copy here; Reveal stays greyed, saying where the file is.
describe('a delivery on another machine’s session', () => {
  // Ticket 627: a terminal (lane A) session over RL2 takes neither command and has no copy route here: both buttons are
  // greyed with the declared sentences. The word cut (T101; task 2 fix round 1): each greyed button keeps the keyboard,
  // its sentence its description and its tooltip on focus, never a system title
  it('greys Open externally and Reveal in Finder for a terminal session over RL2, each with its sentence', () => {
    const TERMINAL = addressOf(OTHER_MACHINE, 'app-a' as AppSessionId);
    overRl2(TERMINAL, {}, 'A');
    const { actions } = renderRow({ ...ROW, files: [{ path: '/repo/report.pdf', name: 'report.pdf', id: 'd-1' }] }, { storeKey: TERMINAL });
    const open = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally: report.pdf', description: REMOTE_UNAVAILABLE['files.openExternal'] });
    const reveal = screen.getByRole<HTMLButtonElement>('button', { name: 'Reveal in Finder: report.pdf', description: REMOTE_UNAVAILABLE['files.reveal'] });
    for (const [button, sentence] of [[open, REMOTE_UNAVAILABLE['files.openExternal']], [reveal, REMOTE_UNAVAILABLE['files.reveal']]] as const) {
      expect([button.disabled, button.getAttribute('aria-disabled'), button.hasAttribute('title')]).toEqual([false, 'true', false]);
      act(() => button.focus());
      expect(document.activeElement).toBe(button);
      expect(screen.getByRole('tooltip').textContent).toBe(sentence);
      act(() => button.blur());
    }
    fireEvent.click(open);
    fireEvent.click(reveal);
    expect(actions.openDelivered).not.toHaveBeenCalled();
    expect(actions.revealDelivered).not.toHaveBeenCalled();
    leaveRl2();
  });

  it('opens a copy through Open externally, and greys Reveal in Finder with “on <machine>”', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
    ]);
    applyRemoteSession(remoteSessionState(REMOTE));
    const { actions } = renderRow({ ...ROW, files: [{ path: '/repo/report.pdf', name: 'report.pdf', id: 'd-1' }] }, { storeKey: REMOTE });
    const open = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally: report.pdf', description: 'Opens a copy of this file from mini on this Mac' });
    const reveal = screen.getByRole<HTMLButtonElement>('button', { name: 'Reveal in Finder: report.pdf', description: 'This file is on mini, not on this Mac' });
    expect([open.disabled, open.hasAttribute('aria-disabled'), reveal.disabled, reveal.getAttribute('aria-disabled')]).toEqual([false, false, false, 'true']);
    expect([open.hasAttribute('title'), reveal.hasAttribute('title')]).toEqual([false, false]);
    // where the file is stays in view: outside the actions, which show only on pointing or focus (T101)
    expect(screen.getByText('on mini').closest('[data-on-hover]')).toBeNull();
    fireEvent.click(open);
    fireEvent.click(reveal);
    expect(actions.openDelivered).toHaveBeenCalledExactlyOnceWith(REMOTE, '/repo/report.pdf');
    expect(actions.revealDelivered).not.toHaveBeenCalled();
  });

  // The touch rule (ticket 830): where nothing points, what a button's tip says (what it does here, why it is greyed)
  // stands after it, drawn by the stylesheet alone (ui/touch-fact.test.tsx) and hidden from assistive technology, which
  // hears it as the button's description; a button with no tip draws none
  it('stands each button’s tip after it for a screen that cannot point, hidden from assistive technology', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
    ]);
    applyRemoteSession(remoteSessionState(REMOTE));
    renderRow({ ...ROW, files: [{ path: '/repo/report.pdf', name: 'report.pdf', id: 'd-1' }] }, { storeKey: REMOTE });
    const buttons = ['Open externally: report.pdf', 'Reveal in Finder: report.pdf'].map((name) => screen.getByRole('button', { name }));
    // each button and its tip's fact are one unit of the actions, so a wrap never sets one button's fact beside the other
    const units = buttons.map((button) => button.parentElement!);
    expect(units.map((unit) => [unit.parentElement!.classList.contains('transcript-delivery-actions'), unit.classList.contains('transcript-delivery-action')])).toEqual([[true, true], [true, true]]);
    expect(units[0]).not.toBe(units[1]);
    const facts = units.map((unit) => unit.querySelectorAll('[data-touch-fact]'));
    expect(facts.map((found) => found.length)).toEqual([1, 1]);
    expect(facts.map((found) => [found[0]!.getAttribute('data-touch-fact'), found[0]!.getAttribute('aria-hidden')])).toEqual([['', 'true'], ['', 'true']]);
    expect(facts.map((found) => found[0]!.textContent)).toEqual(buttons.map((button) => document.getElementById(button.getAttribute('aria-describedby')!)!.textContent));
    cleanup();
    expect(renderRow(ROW, { storeKey: APP }).container.querySelector('.transcript-delivery-actions [data-touch-fact]')).toBeNull();
  });
});

// The submit button (UX wave U4a, l3-input-15): one round button whose glyph follows the decision, its word kept as its
// text and name. And the button of a driven session (P5 O9 M5): Send and Stop each drawn from the port's own capability,
// an unavailable one disabled in place with its reason, as the composer passes them (`Composer.tsx`'s `driven`).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { humanTurn, status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { laneAState, LIVE_OPS } from '../../lane-a/test-support/lane-a-state';
import { laneAControls } from '../../session/controls/lane-a';
import { accessibleDescription } from '../../test-support/accessible-text';
import { SubmitControl } from './SubmitControl';
import { submitState, type SubmitInput } from './submit-state';

const A = at('app-a') as AppSessionId;

function button(ops: string[], running: boolean, empty: boolean): HTMLButtonElement {
  const controls = laneAControls(laneAState(A, { ops, turn: { running, unknown: false } }), null, { appSessionId: A, client: fakeClient().client });
  const driven = { running, send: controls.capability('send'), stop: controls.capability('interrupt') };
  const decision = submitState({ status: null, intent: null, queue: { entries: [], paused: false }, empty, mode: 'send', availability: 'foreign_held', heldBy: 'terminal · 42', driven });
  render(<SubmitControl decision={decision} onPrimary={() => {}} />);
  return screen.getByRole('button') as HTMLButtonElement;
}

afterEach(() => cleanup());

// What the tooltip says once the button holds focus (ticket 815: a Tip, which focus opens); none for a disabled button,
// which takes no focus
function tooltipOf(button: HTMLButtonElement): string | null {
  act(() => button.focus());
  const text = screen.queryByRole('tooltip')?.textContent ?? null;
  act(() => button.blur());
  return text;
}
const greyed = (button: HTMLButtonElement): boolean => button.disabled || button.getAttribute('aria-disabled') === 'true';

describe('the submit button of a driven session', () => {
  it('is Stop, greyed with its reason, while a turn runs on a bridge that can’t interrupt; it keeps Tab and its press does nothing', () => {
    const onPrimary = vi.fn();
    const controls = laneAControls(laneAState(A, { ops: LIVE_OPS.filter((op) => op !== 'interrupt'), turn: { running: true, unknown: false } }), null, { appSessionId: A, client: fakeClient().client });
    const decision = submitState({ status: null, intent: null, queue: { entries: [], paused: false }, empty: true, mode: 'send', availability: 'foreign_held', heldBy: 'terminal · 42', driven: { running: true, send: controls.capability('send'), stop: controls.capability('interrupt') } });
    render(<SubmitControl decision={decision} onPrimary={onPrimary} />);
    const stop = screen.getByRole('button') as HTMLButtonElement;
    expect([stop.textContent, stop.disabled, stop.getAttribute('aria-disabled'), accessibleDescription(stop)]).toEqual(['Stop', false, 'true', 'Not in this session’s sminos (1.25.0)']);
    expect(tooltipOf(stop)).toBe('Not in this session’s sminos (1.25.0)');
    fireEvent.click(stop);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it('is Stop, enabled, on a bridge that interrupts but takes no words', () => {
    const stop = button(LIVE_OPS.filter((op) => op !== 'deliver'), true, true);
    expect([stop.textContent, greyed(stop)]).toEqual(['Stop', false]);
  });

  it('is Send, greyed with its reason, on a bridge that takes no words', () => {
    const send = button(LIVE_OPS.filter((op) => op !== 'deliver'), false, false);
    expect([send.textContent, greyed(send), accessibleDescription(send)]).toEqual(['Send', true, 'Not in this session’s sminos (1.25.0)']);
  });
});

// UX wave U4a (l3-input-15, the child's table): for each state the glyph, the word as the button's text and accessible
// name (the glyph is hidden from assistive technology), and the tooltip.
describe('the submit button for each state of the table', () => {
  const APP = 'app-1' as AppSessionId;
  const idle = status(APP);
  const turning = status(APP, { engineState: 'running', turn: humanTurn });
  const queued = { queueId: 'q-1', appSessionId: APP, content: 'later', createdAt: '2026-09-29T10:00:00.000Z', state: 'queued' as const, messageUuid: null, submittedAt: null, uncertain: false, steer: false };
  const drawn = (over: Partial<SubmitInput>) => {
    cleanup();
    render(<SubmitControl decision={submitState({ status: idle, intent: null, queue: { entries: [], paused: false }, empty: false, mode: 'send', availability: 'usable', heldBy: null, ...over })} onPrimary={() => {}} />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    return [button.dataset.glyph, button.textContent, tooltipOf(button), greyed(button)];
  };

  it('draws each state’s glyph, keeps its word, and says what it does', () => {
    expect(drawn({})).toEqual(['arrow', 'Send', 'Send · Enter', false]);
    expect(drawn({ empty: true }), 'an empty editor’s Send is disabled, with no reason to say').toEqual(['arrow', 'Send', null, true]);
    expect(drawn({ status: turning, empty: true })).toEqual(['square', 'Stop', 'Stop the running turn · ⌘.', false]);
    expect(drawn({ status: turning })).toEqual(['queue', 'Send', 'Sends at the next step · Enter · ⌘Enter queues for later', false]);
    expect(drawn({ queue: { entries: [queued], paused: true }, empty: true })).toEqual(['play', 'Resume', 'Resume the paused queue', false]);
    expect(drawn({ mode: 'bash' })).toEqual(['arrow', 'Run', 'Run · Enter', false]);
    expect(drawn({ mode: 'memory' })).toEqual(['arrow', 'Save to memory', 'Save to memory · Enter', false]);
    expect(drawn({ mode: 'bash', status: turning })).toEqual(['arrow', 'Run', 'Runs now; the model sees the output in this turn · Enter', false]);
    expect(drawn({ status: null, intent: { starting: false, messageHeld: false, phase: 'Creating worktree one…' } })).toEqual(['spinner', 'Starting…', 'Creating worktree one…', true]);
  });

  it('names a terminal session’s send during its turn by Enter alone', () => {
    const open = { available: true } as const;
    expect(drawn({ status: null, availability: 'foreign_held', heldBy: 'terminal · 42', driven: { running: true, send: open, stop: open } })).toEqual(['queue', 'Send', 'Sends at the next step · Enter', false]);
  });

  it('is found by its word: the glyph is hidden from assistive technology', () => {
    drawn({ status: turning, empty: true });
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

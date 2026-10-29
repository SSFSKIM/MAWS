// The submit button of a driven session (P5 O9 M5): Send and Stop each drawn from the port's own capability, an
// unavailable one disabled in place with its reason, as the composer passes them (`Composer.tsx`'s `driven`).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { laneAState, LIVE_OPS } from '../../lane-a/test-support/lane-a-state';
import { laneAControls } from '../../session/controls/lane-a';
import { SubmitControl } from './SubmitControl';
import { submitState } from './submit-state';

const A = at('app-a') as AppSessionId;

function button(ops: string[], running: boolean, empty: boolean): HTMLButtonElement {
  const controls = laneAControls(laneAState(A, { ops, turn: { running, unknown: false } }), null, { appSessionId: A, client: fakeClient().client });
  const driven = { running, send: controls.capability('send'), stop: controls.capability('interrupt') };
  const decision = submitState({ status: null, intent: null, queue: { entries: [], paused: false }, empty, mode: 'send', availability: 'foreign_held', heldBy: 'terminal · 42', driven });
  render(<SubmitControl decision={decision} multiline={false} onPrimary={() => {}} />);
  return screen.getByRole('button') as HTMLButtonElement;
}

afterEach(() => cleanup());

describe('the submit button of a driven session', () => {
  it('is Stop, disabled with its reason, while a turn runs on a bridge that can’t interrupt', () => {
    const stop = button(LIVE_OPS.filter((op) => op !== 'interrupt'), true, true);
    expect([stop.textContent, stop.disabled, stop.title]).toEqual(['Stop', true, 'Not in this session’s sminos (1.25.0)']);
  });

  it('is Stop, enabled, on a bridge that interrupts but takes no words', () => {
    const stop = button(LIVE_OPS.filter((op) => op !== 'deliver'), true, true);
    expect([stop.textContent, stop.disabled]).toEqual(['Stop', false]);
  });

  it('is Send, disabled with its reason, on a bridge that takes no words', () => {
    const send = button(LIVE_OPS.filter((op) => op !== 'deliver'), false, false);
    expect([send.textContent, send.disabled, send.title]).toEqual(['Send', true, 'Not in this session’s sminos (1.25.0)']);
  });
});

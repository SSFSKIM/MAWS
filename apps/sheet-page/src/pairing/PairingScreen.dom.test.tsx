// @vitest-environment happy-dom
// The pairing screen after an unpairing or a refusal (§P; T10): one line above the heading says what became of the
// pairing, and keeps a revocation mawsd could not save, and one mawsd was never told of, apart from a confirmed one.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PAIRING } from '../copy';
import { PairingScreen } from './PairingScreen';

afterEach(cleanup);

const shown = (unpaired: Parameters<typeof PairingScreen>[0]['unpaired']) => {
  render(<PairingScreen unpaired={unpaired} pair={async () => ({ ok: false, why: 'failed' })} onPaired={() => {}} />);
  return screen.queryByTestId('unpaired')?.textContent ?? null;
};

describe('the pairing screen’s line on what became of the pairing', () => {
  it('is absent on a first visit', () => {
    expect(shown(null)).toBeNull();
  });

  it('says the browser is not paired after a refusal and after a confirmed Unpair', () => {
    expect(shown('refused')).toBe(PAIRING.notPaired);
    cleanup();
    expect(shown('revoked')).toBe(PAIRING.notPaired);
  });

  it('says so when MAWS could not save the change, and that a restart before a save pairs the browser again', () => {
    const line = shown('not-saved');
    expect(line).toBe(`${PAIRING.notPaired} ${PAIRING.unpairNotSaved}`);
    expect(line).toMatch(/could not save/);
    expect(line).toMatch(/paired again if mawsd restarts before/);
  });

  it('says so when the browser forgot its pairing without MAWS being told', () => {
    const line = shown('local');
    expect(line).toBe(`${PAIRING.notPaired} ${PAIRING.unpairLocal}`);
    cleanup();
    expect(line).not.toBe(shown('not-saved'));
  });
});

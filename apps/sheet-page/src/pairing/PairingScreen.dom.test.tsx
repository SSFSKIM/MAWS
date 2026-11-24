// @vitest-environment happy-dom
// The pairing screen after an unpairing or a refusal (§P; T10): one line above the heading says what became of the
// pairing, and keeps a revocation mawsd could not save, and one mawsd did not confirm, apart from a confirmed one.
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

  it('says so when MAWS could not save the change, and that the old pairing may be accepted again on a restart before a save', () => {
    const line = shown('not-saved');
    expect(line).toBe(`${PAIRING.notPaired} ${PAIRING.unpairNotSaved}`);
    expect(line).toMatch(/could not save/);
    expect(line).toMatch(/old pairing may be accepted again if mawsd restarts before/);
    expect(line).not.toMatch(/this browser is paired again/i); // its own credential is gone: only the old one could work again
  });

  it('says the browser forgot its pairing and MAWS did not confirm the removal, without claiming MAWS still lists it', () => {
    const line = shown('local');
    expect(line).toBe(`${PAIRING.notPaired} ${PAIRING.unpairLocal}`);
    expect(line).toMatch(/forgot its pairing/);
    expect(line).toMatch(/did not confirm/);
    expect(line).toMatch(/mawsd sheet browsers/);
    expect(line).toMatch(/mawsd sheet unpair <id>/);
    expect(line).not.toMatch(/still lists/); // a lost answer or a 401 can mean it is already gone
    cleanup();
    expect(line).not.toBe(shown('not-saved'));
  });
});

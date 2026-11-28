// The pairing screen's field and its refusals ("The look", frame 1): the code as the person types it, and each answer of
// the exchange as the one line under the field.
import { describe, expect, it } from 'vitest';
import { codeOf, refusalOf, shownCode } from './PairingScreen';

describe('the code field', () => {
  it('keeps letters and digits only, upper case, at most eight, and shows the dash itself', () => {
    expect(codeOf('k7qf-2m9d')).toBe('K7QF2M9D');
    expect(codeOf(' K7QF 2M9D extra')).toBe('K7QF2M9D');
    expect(shownCode('K7QF')).toBe('K7QF');
    expect(shownCode('K7QF2')).toBe('K7QF-2');
    expect(shownCode('K7QF2M9D')).toBe('K7QF-2M9D');
    expect(codeOf(shownCode('K7QF2M9D'))).toBe('K7QF2M9D'); // what the field shows reads back as the same code
  });
});

describe('a refusal', () => {
  it('is the look’s line for each answer of the exchange', () => {
    expect(refusalOf({ ok: false, why: 'wrong', left: 3 })).toBe('That code is not right. 3 tries left.');
    expect(refusalOf({ ok: false, why: 'wrong', left: 1 })).toBe('That code is not right. 1 try left.');
    expect(refusalOf({ ok: false, why: 'wrong', left: 0 })).toBe('Too many tries. Run the command again for a new code.');
    expect(refusalOf({ ok: false, why: 'expired' })).toBe('That code has expired. Run the command again.');
    expect(refusalOf({ ok: false, why: 'none' })).toBe('That code has expired. Run the command again.');
    expect(refusalOf({ ok: false, why: 'busy' })).toBe('Too many tries. Wait a minute, then try again.');
    expect(refusalOf({ ok: false, why: 'not-saved' })).toBe('MAWS could not save the pairing. Try again.');
    expect(refusalOf({ ok: false, why: 'failed' })).toBe('MAWS did not answer. Try again.');
  });
});

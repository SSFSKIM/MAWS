// A method's label names when it was added in the desk's one display locale (P4 Decision Log 4): the label is stored
// with the method's copy and read in the key dialog beside the desk's other English. This project runs under a Korean
// system locale (vitest.config.ts), where a formatter on the default locale writes "2026년 10월 6일 PM 02:05".
import { expect, it } from 'vitest';
import { methodLabel } from './labels';

it('names the kind and when it was added, in English', () => {
  const at = new Date(2026, 9, 6, 14, 5);
  expect(methodLabel('passkey', at).replace(/\s/g, ' ')).toBe('Passkey, added Oct 6, 2026, 2:05 PM');
  expect(methodLabel('passphrase', at).replace(/\s/g, ' ')).toBe('Passphrase, added Oct 6, 2026, 2:05 PM');
});

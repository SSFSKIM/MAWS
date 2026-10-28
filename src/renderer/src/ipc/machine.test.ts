import { expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { machineFor, storedSessionOnPage } from './machine';

// P5 O6 M2 (OX2): a surface that holds a path is its session's machine's, else this machine's
it('names the machine of a session, else the local one', () => {
  expect(machineFor(addressOf(OTHER_MACHINE, 'app-a' as AppSessionId))).toBe(OTHER_MACHINE);
  expect(machineFor(at('app-a' as AppSessionId))).toBe(TEST_MACHINE);
  expect(machineFor(null)).toBe(TEST_MACHINE);
});

// An artifact's content holds the session ids main wrote (bare, the local library's); the page looks them up by address
it('reads a session id an artifact holds as the local machine’s address, and keeps an address as it is', () => {
  expect(storedSessionOnPage('app-a')).toBe(at('app-a'));
  const remote = addressOf(OTHER_MACHINE, 'app-b' as AppSessionId);
  expect(storedSessionOnPage(remote)).toBe(remote);
});

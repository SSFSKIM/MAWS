// C10's message return, with P2-E1's per-session claim (P2-E1 document, D6): a comment card holding a pending reply
// claims a failed start's returned message for its thread, so the text goes back into the card's field, never into the
// thread's unseen composer draft; every other session's return, and its own once the claim is disposed, goes the
// registered way.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { holdMessageReturn, registerMessageReturn, returnMessage } from './message-return';

const ONE = 'one' as AppSessionId;
const TWO = 'two' as AppSessionId;
const MESSAGE = { content: 'Bigger, please', display: 'Bigger, please' };

const offs: (() => void)[] = [];
afterEach(() => offs.splice(0).forEach((off) => off()));

describe('holdMessageReturn', () => {
  it('a holder takes the return for its session only; its disposer restores the registered path', () => {
    const registered = vi.fn();
    const held = vi.fn();
    offs.push(registerMessageReturn(registered));
    const release = holdMessageReturn(ONE, held);
    offs.push(release);

    returnMessage(ONE, MESSAGE);
    returnMessage(TWO, MESSAGE);
    expect(held.mock.calls).toEqual([[ONE, MESSAGE]]);
    expect(registered.mock.calls).toEqual([[TWO, MESSAGE]]);

    release();
    returnMessage(ONE, MESSAGE);
    expect(held).toHaveBeenCalledTimes(1);
    expect(registered.mock.calls).toEqual([[TWO, MESSAGE], [ONE, MESSAGE]]);
  });

  it('a stale disposer leaves a newer holder of the session in place', () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = holdMessageReturn(ONE, first);
    offs.push(holdMessageReturn(ONE, second));
    releaseFirst();
    returnMessage(ONE, MESSAGE);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

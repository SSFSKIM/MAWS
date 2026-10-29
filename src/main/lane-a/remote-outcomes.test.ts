// Remote lane A's outcomes (P5 O9 M9, "Outcomes"): the link's never-rejecting `ActOutcome` in the port's types.
import { describe, expect, it } from 'vitest';
import { controlOf, sendFate } from './remote-outcomes';

describe('a remote act’s outcome', () => {
  it('maps done, failed by its code, refused, not-sent and unknown to ControlResult', () => {
    expect(controlOf({ state: 'done', result: { started: true, id: 'op-1' } }, 'mini')).toEqual({ state: 'done', result: { started: true, id: 'op-1' } });
    expect(controlOf({ state: 'failed', error: { code: 'read-only' } }, 'mini')).toEqual({ state: 'refused', code: 'read-only', message: 'mini is read-only: it runs nothing sent from outside it' });
    expect(controlOf({ state: 'failed', error: {} }, 'mini')).toMatchObject({ state: 'refused', code: 'failed' });
    expect(controlOf({ state: 'refused', reason: 'offline' }, 'mini')).toEqual({ state: 'refused', code: 'offline', message: 'mini wasn’t reachable within a minute; nothing ran' });
    expect(controlOf({ state: 'not-sent' }, 'mini')).toMatchObject({ state: 'refused', code: 'not-sent' });
    expect(controlOf({ state: 'unknown', reason: 'expired' }, 'mini')).toEqual({ state: 'unknown', why: 'expired' });
    expect(controlOf({ state: 'unknown', reason: 'closed' }, 'mini')).toEqual({ state: 'unknown', why: 'gone' });
  });

  it('reads a send’s fate: entered with its row, unconfirmed past sminos’s bound or unknown, refused with its words', () => {
    expect(sendFate({ state: 'done', result: { entered: true, uuid: 'row-1' } }, 'mini')).toEqual({ state: 'entered', uuid: 'row-1' });
    expect(sendFate({ state: 'done', result: { submitted: true } }, 'mini')).toMatchObject({ state: 'unconfirmed' });
    expect(sendFate({ state: 'unknown', reason: 'expired' }, 'mini')).toMatchObject({ state: 'unconfirmed' });
    expect(sendFate({ state: 'failed', error: { code: 'unsupported' } }, 'mini')).toEqual({ state: 'refused', code: 'unsupported', reason: 'mini’s sminos predates sends from MAWS: update sminos there' });
    expect(sendFate({ state: 'failed', error: { code: 'duplicate' } }, 'mini')).toEqual({ state: 'refused', code: 'duplicate', reason: 'the bridge had already taken this message' });
  });
});

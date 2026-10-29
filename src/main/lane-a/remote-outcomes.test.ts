// Remote lane A's outcomes (P5 O9 M9, "Outcomes"): the link's never-rejecting `ActOutcome` in the port's types.
import { describe, expect, it } from 'vitest';
import { controlOf, linkView, sendFate } from './remote-outcomes';

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

describe('a remote session’s link', () => {
  const caps = { member: 'm-a', device: 'd-a', clientClass: 'native-mac' as const, machine: { grades: ['spawn' as const] }, stateVersion: 3 };
  const link = (fields: Partial<{ state: 'connecting' | 'up' | 'down'; refusal: string | null; carrier: 'direct' | 'relay' | null; caps: typeof caps | null }> = {}) => {
    const f = { state: 'up' as const, refusal: null, carrier: 'direct' as const, caps, ...fields };
    return { name: 'mini', state: () => f.state, refusal: () => f.refusal, carrier: () => f.carrier, caps: () => f.caps };
  };

  it('acts from an up link with caps, saying who this device is there and its machine rights', () => {
    expect(linkView(link())).toEqual({ state: 'up', refusal: null, carrier: 'direct', member: 'm-a', clientClass: 'native-mac', rights: ['spawn'], reason: null });
  });

  it('says why nothing acts: refused, down, connecting, no caps yet, or a device that acts on cards only', () => {
    expect(linkView(link({ state: 'down', refusal: 'removed', carrier: null }))).toMatchObject({ state: 'down', refusal: 'removed', reason: 'mini refused this device (removed)' });
    expect(linkView(link({ state: 'down', carrier: null }))).toMatchObject({ reason: 'mini isn’t reachable' });
    expect(linkView(link({ state: 'connecting', carrier: null, caps: null }))).toMatchObject({ member: null, clientClass: null, rights: [], reason: 'connecting to mini' });
    expect(linkView(link({ caps: null }))).toMatchObject({ reason: 'waiting for mini to say what this device may do' });
    expect(linkView(link({ caps: { ...caps, clientClass: 'web-cards' as never } }))).toMatchObject({ reason: 'this device answers cards only' });
  });
});

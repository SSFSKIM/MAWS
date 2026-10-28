// The lane A store (P5 O9 M5): each bridged foreign session's `LaneAState` from `laneA.changed` and `laneA.list`, its
// catalog's body by fingerprint, and the pending-send strip's entries following the state's deliveries.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import { laneACatalog, laneAState } from '../lane-a/test-support/lane-a-state';
import { applyLaneAList, applyLaneAState, connectLaneA, holdPendingSend, dismissPendingSend, noteLaneASettlement, resetLaneAStore, useLaneA } from './lane-a';

const A = at('app-a') as AppSessionId;
const B = at('app-b') as AppSessionId;
const key = { writer: 'maws/m', seq: 7 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => resetLaneAStore());

describe('connectLaneA', () => {
  it('subscribes before it lists, and applies a change that raced the list after it', async () => {
    const fake = fakeClient({ 'laneA.catalog': laneACatalog() });
    const off = connectLaneA(fake.client);
    expect(fake.calls.slice(0, 2)).toEqual(['on laneA.changed', 'invoke laneA.list']);
    fake.event('laneA.changed', { appSessionId: A, state: laneAState(A, { turn: { running: true, unknown: false } }) });
    await fake.reply('laneA.list', { states: [laneAState(A), laneAState(B)] });
    expect(useLaneA.getState().states.get(A)?.turn.running).toBe(true); // the event that raced it wins
    expect(useLaneA.getState().states.has(B)).toBe(true);
    fake.event('laneA.changed', { appSessionId: B, state: null });
    expect(useLaneA.getState().states.has(B)).toBe(false);
    off();
  });

  it('goes live on events when the list is refused', async () => {
    const fake = fakeClient({ 'laneA.catalog': laneACatalog() });
    connectLaneA(fake.client);
    fake.event('laneA.changed', { appSessionId: A, state: laneAState(A) });
    await fake.fail('laneA.list');
    expect(useLaneA.getState().states.has(A)).toBe(true);
  });
});

describe('the states', () => {
  it('replaces one machine’s partition from its list, leaving another machine’s', () => {
    const other = addressOf(OTHER_MACHINE, 'app-o') as AppSessionId;
    applyLaneAState(other, laneAState(other));
    applyLaneAState(A, laneAState(A));
    applyLaneAList(TEST_MACHINE, [laneAState(B)]);
    expect([...useLaneA.getState().states.keys()].sort()).toEqual([B, other].sort());
  });

  it('reads the catalog’s body once per fingerprint', async () => {
    const fake = fakeClient({ 'laneA.catalog': laneACatalog() });
    connectLaneA(fake.client);
    await fake.reply('laneA.list', { states: [laneAState(A)] });
    applyLaneAState(A, laneAState(A, { turn: { running: true, unknown: false } }));
    await settle();
    expect(fake.invoked('laneA.catalog')).toEqual([{ appSessionId: A }]);
    expect(useLaneA.getState().catalogs.get(A)?.fingerprint).toBe('fp-1');
    applyLaneAState(A, laneAState(A, { catalog: { fingerprint: 'fp-2' } }));
    await settle();
    expect(fake.invoked('laneA.catalog')).toHaveLength(2);
  });
});

describe('the pending-send strip', () => {
  it('keeps a send by its key until it enters; a refusal and an unconfirmed fate stay with their reason', () => {
    applyLaneAState(A, laneAState(A, { deliveries: [{ key, at: 't', state: 'submitted' }] }));
    holdPendingSend(A, key, 'first words');
    expect(useLaneA.getState().pendingSends.get(A)).toEqual([{ key, text: 'first words', state: 'sending', reason: null }]);
    applyLaneAState(A, laneAState(A, { deliveries: [{ key, at: 't', state: 'refused', reason: 'the session was busy' }] }));
    expect(useLaneA.getState().pendingSends.get(A)).toEqual([{ key, text: 'first words', state: 'refused', reason: 'the session was busy' }]);
    dismissPendingSend(A, key);
    expect(useLaneA.getState().pendingSends.get(A) ?? []).toEqual([]);

    const next = { writer: 'maws/m', seq: 8 };
    holdPendingSend(A, next, 'second');
    applyLaneAState(A, laneAState(A, { deliveries: [{ key: next, at: 't', state: 'unconfirmed' }] }));
    expect(useLaneA.getState().pendingSends.get(A)?.[0]).toMatchObject({ state: 'unconfirmed' });
    applyLaneAState(A, laneAState(A, { deliveries: [{ key: next, at: 't', state: 'entered', uuid: 'row-8' }] }));
    expect(useLaneA.getState().pendingSends.get(A) ?? []).toEqual([]);
  });

  it('takes a fate that arrived before the send was held, and keeps a settled entry once the state forgets it', () => {
    applyLaneAState(A, laneAState(A, { deliveries: [{ key, at: 't', state: 'refused', reason: 'no' }] }));
    holdPendingSend(A, key, 'words');
    expect(useLaneA.getState().pendingSends.get(A)?.[0]).toMatchObject({ state: 'refused', reason: 'no' });
    applyLaneAState(A, laneAState(A, { deliveries: [] }));
    expect(useLaneA.getState().pendingSends.get(A)?.[0]).toMatchObject({ state: 'refused', reason: 'no' });
  });

  it('reads a send still sending as unconfirmed once its session leaves lane A', () => {
    applyLaneAState(A, laneAState(A, { deliveries: [{ key, at: 't', state: 'submitted' }] }));
    holdPendingSend(A, key, 'words');
    applyLaneAState(A, null);
    expect(useLaneA.getState().pendingSends.get(A)?.[0]).toMatchObject({ state: 'unconfirmed' });
  });
});

// P5 O9 M6: what a late answer was told of who won, kept while the session is in lane A
describe('the settlements an answer was told', () => {
  it('keeps each by its request, and forgets them when the session leaves lane A', () => {
    applyLaneAState(A, laneAState(A));
    noteLaneASettlement(A, 'r1', { winner: 'terminal', outcome: 'allow', by: 'terminal' });
    noteLaneASettlement(A, 'r2', { winner: null, outcome: null, by: null, terminalOnly: true });
    expect([...(useLaneA.getState().told.get(A) ?? new Map()).keys()]).toEqual(['r1', 'r2']);
    applyLaneAState(A, laneAState(A, { turn: { running: true, unknown: false } }));
    expect(useLaneA.getState().told.get(A)?.get('r1')).toEqual({ winner: 'terminal', outcome: 'allow', by: 'terminal' });
    applyLaneAState(A, null);
    expect(useLaneA.getState().told.has(A)).toBe(false);
  });
});

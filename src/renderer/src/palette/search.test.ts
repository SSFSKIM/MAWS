import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { searchConversations, searchedMachines } from './search';

// P5 O7 M6 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6 "Search"): the query goes to this Mac and to each
// `up` RL2 machine; the hits come back under their machine, this Mac's first; a machine that can't answer is left out.
const THIRD = 'ThirdMachineRef0000000' as MachineRef;
const entry = (ref: MachineRef, state: MachineState['state']): MachineState => ({ ref, name: ref, local: ref === TEST_MACHINE, state, since: '2026-11-01T00:00:00Z', generation: 1 });
const hit = (appSessionId: string, snippet: string | null = null) => ({ appSessionId: appSessionId as AppSessionId, snippet });
const answer = (hits: ReturnType<typeof hit>[], over: { indexing?: boolean; incomplete?: boolean } = {}) => ({ hits, indexing: false, incomplete: false, ...over });

describe('the machines a search asks', () => {
  it('each listed (RL2) machine that is up, in the roster’s order, never this Mac or a machine only a socket reaches', () => {
    const roster = new Map([TEST_MACHINE, OTHER_MACHINE, THIRD, 'SocketMachineRef000000' as MachineRef].map((m, i) => [m, entry(m, i === 2 ? 'down' : 'up')]));
    expect(searchedMachines(new Set([THIRD, OTHER_MACHINE]), roster)).toEqual([OTHER_MACHINE]);
    roster.set(THIRD, entry(THIRD, 'up'));
    expect(searchedMachines(new Set([THIRD, OTHER_MACHINE]), roster)).toEqual([OTHER_MACHINE, THIRD]);
  });
});

describe('a search across machines', () => {
  it('sends the query to this Mac and to each machine, and merges the hits under their machine, this Mac’s first', async () => {
    const fake = fakeClient();
    const search = searchConversations(fake.client, 'deploy', [OTHER_MACHINE, THIRD]);
    expect(fake.invoked('session.search')).toEqual([{ query: 'deploy' }, { query: 'deploy' }, { query: 'deploy' }]);
    expect(fake.machines('session.search')).toEqual([undefined, OTHER_MACHINE, THIRD]);
    await fake.reply('session.search', answer([hit(addressOf(THIRD, 'c1'))], { incomplete: true }), 2); // the last answers first
    await fake.reply('session.search', answer([hit(at('a1'), 'a deploy'), hit(at('a2'))]));
    await fake.reply('session.search', answer([hit(addressOf(OTHER_MACHINE, 'b1'), 'deploy there')], { indexing: true }));
    expect(await search).toEqual({
      groups: [
        { machine: TEST_MACHINE, hits: [hit(at('a1'), 'a deploy'), hit(at('a2'))] },
        { machine: OTHER_MACHINE, hits: [hit(addressOf(OTHER_MACHINE, 'b1'), 'deploy there')] },
        { machine: THIRD, hits: [hit(addressOf(THIRD, 'c1'))] },
      ],
      indexing: true,
      incomplete: true,
      errors: [],
    });
  });

  // M6b's fix wave 1: main answers an endpoint with no search row host_unavailable, so that is the one omission; an
  // internal failure, whatever its issues, is named like any other
  it('leaves out, with no error, a machine that answers host_unavailable; an internal failure is named', async () => {
    const fake = fakeClient();
    const search = searchConversations(fake.client, 'deploy', [OTHER_MACHINE, THIRD]);
    await fake.reply('session.search', answer([hit(at('a1'))]));
    await fake.fail('session.search', 'Studio is offline', 'host_unavailable');
    await fake.fail('session.search', 'not offered', 'internal', { refusal: 'not-offered' });
    expect(await search).toEqual({ groups: [{ machine: TEST_MACHINE, hits: [hit(at('a1'))] }], indexing: false, incomplete: false, errors: [{ machine: THIRD, message: 'not offered' }] });
  });

  it('names any other failure with its machine, this Mac’s included, and keeps every answer it has', async () => {
    const fake = fakeClient();
    const search = searchConversations(fake.client, 'deploy', [OTHER_MACHINE]);
    await fake.fail('session.search', 'index unavailable', 'host_unavailable'); // this Mac's is never left out quietly
    await fake.fail('session.search', 'refused', 'timeout');
    expect(await search).toEqual({
      groups: [],
      indexing: false,
      incomplete: false,
      errors: [{ machine: TEST_MACHINE, message: 'index unavailable' }, { machine: OTHER_MACHINE, message: 'refused' }],
    });
  });

  it('a call that throws reads as that machine’s failure', async () => {
    const fake = fakeClient();
    const invoke = (_name: unknown, _input: unknown, opts?: unknown) => (opts === undefined ? Promise.resolve({ ok: true, value: answer([]) }) : Promise.reject(new Error('bridge gone')));
    vi.spyOn(fake.client, 'invoke').mockImplementation(invoke as never);
    expect(await searchConversations(fake.client, 'deploy', [OTHER_MACHINE])).toEqual({ groups: [{ machine: TEST_MACHINE, hits: [] }], indexing: false, incomplete: false, errors: [{ machine: OTHER_MACHINE, message: 'Error: bridge gone' }] });
  });
});

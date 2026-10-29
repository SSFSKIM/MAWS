// Another machine's terminal session in the agents tool (P5 O9 M9, "Remote gaps": a subagent's own rows are withheld,
// the tree and its statuses still show): the task graph store's watch of such a session reads the subagent tree its
// plane transcript keeps (the DX4 metas and statuses over the held rows), as desk-web's depth column does, and never
// this machine's agent-work reads.
import type { SessionMessage, SubagentMeta } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { resetLaneAStore } from '../stores/lane-a';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { createTaskGraphStore } from '../tools/agents/store';
import { preloadOf } from '../test-support/preload-of';
import { settle } from './test-support/fake-plane';
import { connectRemoteAgents } from './remote-agents';
import { resetRemoteTranscripts } from './remote-source';
import { resetLaneAWatches } from './watches';

const SESSION = 'eng-r';
const REMOTE = addressOf(OTHER_MACHINE, SESSION as AppSessionId);
const AGENT = 'a1f0000000000001';

let n = 0;
const envelope = (kind: string, body: unknown): SessionMessage => ({ project: 'p', machine: OTHER_MACHINE, session: SESSION, kind, sub: 'up-1', n: kind === 'snapshot' ? 0 : ++n, body }) as SessionMessage;
const meta = (status: 'running' | 'completed', outcome?: { at: string; summary: string }): SubagentMeta =>
  ({ agentId: AGENT, meta: { agentType: 'Explore', description: 'Find the config files' }, status, evidence: 'bridge', ...(outcome && { outcome }) }) as SubagentMeta;

let fake: FakeClient;
let off: () => void = () => {};
beforeEach(() => {
  n = 0;
  resetLaneAStore();
  resetLaneAWatches();
  resetRemoteTranscripts();
  useTranscriptStore.setState({ entries: {} });
  useSessions.setState({ records: new Map(), listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, SESSION, { lane: 'A', availability: 'foreign_held' }), appId: REMOTE }]]) });
  fake = fakeClient({ 'laneA.watch': { watch: 'w1' } });
  window.maws = preloadOf(fake);
  off = connectRemoteAgents();
});
afterEach(() => {
  off();
  resetRemoteTranscripts();
  resetLaneAWatches();
  useSessions.setState({ listed: new Map() });
});

const plane = (messages: SessionMessage[]) => fake.event('laneA.plane', { appSessionId: SESSION, watch: 'w1', messages }, OTHER_MACHINE);
const wait = async (ok: () => boolean) => {
  for (let i = 0; i < 50 && !ok(); i++) await settle();
};

describe('the agents tool for another machine’s terminal session', () => {
  it('reads the plane’s subagent tree, the snapshot’s statuses and then a live status update, with no agent-work read', async () => {
    const store = createTaskGraphStore();
    const release = store.getState().watch(REMOTE);
    await wait(() => fake.invoked('laneA.watch').length > 0);
    expect(fake.invoked('laneA.watch')).toEqual([{ appSessionId: SESSION }]); // main's bare id, asked of the session's machine
    plane([envelope('snapshot', { rows: [], more: false, subagents: [meta('running')], presence: { record: { status: 'busy' }, bridge: true, launch: 'L1' }, streaming: [] })]);
    const node = () => store.getState().entries.get(REMOTE)?.graph.tasks.get(AGENT as TaskId);
    await wait(() => node() !== undefined);
    expect(node()).toMatchObject({ status: 'running', description: 'Find the config files' });
    expect(store.getState().entries.get(REMOTE)?.phase).toBe('live');
    plane([envelope('subagents', { subagents: [meta('completed', { at: '2026-10-29T08:01:00.000Z', summary: 'Found two.' })] })]);
    await wait(() => node()?.status === 'completed');
    expect(node()).toMatchObject({ status: 'completed', summary: 'Found two.' });
    const local = ['session.events', 'fs.subagents', 'fs.workflows', 'session.stopTask'];
    expect(fake.calls.filter((call) => local.some((name) => call === `invoke ${name}`))).toEqual([]);
    release();
    await settle();
    expect(fake.invoked('laneA.unwatch')).toEqual([{ appSessionId: SESSION, watch: 'w1' }]);
  });

  it('leaves a session of this machine to the agent-work reads', () => {
    const local = addressOf(OTHER_MACHINE, 'not-listed' as AppSessionId);
    const store = createTaskGraphStore();
    const release = store.getState().watch(local);
    expect(fake.invoked('laneA.watch')).toEqual([]);
    release();
  });
});

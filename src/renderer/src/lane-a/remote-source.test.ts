// Another machine's terminal session as a transcript (P5 O9 M9): the page's lane A watch of a listed lane A row carries
// the machine's DX4 plane into `plane-transcript.ts`, and MAWS's store draws it. Pre-flight item 6 is pinned here: a send
// from MAWS that the machine's bridge delivered draws as the person's words, never as a notice, whether it entered a
// running turn or waited for the turn its wake opened.
import type { JsonObject, SessionMessage } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { resetLaneAStore } from '../stores/lane-a';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import type { Row } from '../transcript/model/rows';
import { Chain, SESSION, wakeAfterStop } from './test-support/chain-rows';
import { mount, settle } from './test-support/fake-plane';
import { holdRemoteAgentTranscript, holdRemoteTranscript, remoteAgentTranscriptOf, remoteTranscriptOf, resetRemoteTranscripts } from './remote-source';
import { resetLaneAWatches } from './watches';

const APP = addressOf(OTHER_MACHINE, SESSION as AppSessionId);
type User = Extract<Row, { kind: 'user' }>;

let n = 0;
const envelope = (kind: string, body: unknown, sub: string | null = 'up-1'): SessionMessage =>
  ({ project: 'p', machine: OTHER_MACHINE, session: SESSION, kind, sub, n: kind === 'snapshot' ? 0 : sub === null ? null : ++n, body }) as SessionMessage;
const snapshot = (rows: JsonObject[], more = false) => envelope('snapshot', { rows: [...rows].reverse(), more, subagents: [], presence: { record: { status: 'idle' }, bridge: true, launch: 'L1' }, streaming: [] });

beforeEach(() => {
  n = 0;
  resetLaneAStore();
  resetLaneAWatches();
  resetRemoteTranscripts();
  useTranscriptStore.setState({ entries: {} });
  useSessions.setState({ records: new Map(), listed: new Map([[APP, { ...remoteRow(OTHER_MACHINE, SESSION, { lane: 'A', availability: 'foreign_held' }), appId: APP }]]) });
});
afterEach(() => {
  resetRemoteTranscripts();
  resetLaneAWatches();
});

async function opened(given: Parameters<typeof fakeClient>[0] = {}) {
  const fake = fakeClient({ 'laneA.watch': { watch: 'w1' }, 'laneA.read': { ok: true, result: { requested: true } }, ...given });
  const transcript = remoteTranscriptOf(APP, fake.client);
  const release = holdRemoteTranscript(APP, transcript);
  const unmount = mount(transcript, useTranscriptStore);
  await settle();
  const plane = (messages: SessionMessage[]) => fake.event('laneA.plane', { appSessionId: APP, watch: 'w1', messages }, OTHER_MACHINE);
  return { fake, transcript, plane, close: () => (unmount(), release()) };
}

const drawn = () => useTranscriptStore.getState().entries[APP]?.rows ?? [];
const user = (text: string) => drawn().find((row): row is User => row.kind === 'user' && row.text === text);
const notices = () => drawn().flatMap((row) => (row.kind === 'error' ? [JSON.stringify(row)] : []));
const wait = async (ok: () => boolean) => {
  for (let i = 0; i < 50 && !ok(); i++) await settle();
};

describe('a remote lane A session’s transcript', () => {
  it('opens the page’s watch of a listed lane A row and draws the machine’s snapshot and live rows under its address', async () => {
    const c = new Chain('c4a1e000', 'sminos');
    c.prompt('List the files.');
    const { fake, plane, close } = await opened();
    expect(fake.invoked('laneA.watch')).toEqual([{ appSessionId: APP }]);
    plane([snapshot(c.rows)]);
    c.answer('Two files.');
    plane([envelope('row', { row: c.rows.at(-1), agentId: null })]);
    await wait(() => drawn().some((row) => row.kind === 'assistant_text'));
    expect(user('List the files.')).toBeDefined();
    expect(drawn().find((row) => row.kind === 'assistant_text')).toMatchObject({ markdown: 'Two files.' });
    close();
  });

  it('asks older rows of the watch, which name its subscription in main, and draws them before the held ones', async () => {
    const c = new Chain('c4a1e100', 'sminos');
    c.prompt('Older words.');
    c.answer('Older answer.');
    const older = c.rows.splice(0);
    c.prompt('Newer words.');
    const { fake, transcript, plane, close } = await opened();
    plane([snapshot(c.rows, true)]);
    await wait(() => user('Newer words.') !== undefined);
    transcript.loadOlder();
    await wait(() => fake.invoked('laneA.read').length > 0);
    expect(fake.invoked('laneA.read')).toEqual([{ appSessionId: APP, watch: 'w1', kind: 'rows', args: { before: c.rows[0].uuid, limit: 100 } }]);
    plane([envelope('rows', { rows: [...older].reverse(), before: c.rows[0].uuid, more: false })]);
    await wait(() => user('Older words.') !== undefined);
    expect(drawn().filter((row) => row.kind === 'user').map((row) => (row as User).text)).toEqual(['Older words.', 'Newer words.']);
    close();
  });

  // Fix wave 1: main answers a read it could not carry (the link down) with `ok: false`, and no page follows; a replay
  // resume then sends no snapshot. The ask clears with its reason, and is asked again once the plane delivers again.
  it('clears an older page the link could not carry, and asks it again once the plane delivers after a replay resume', async () => {
    const c = new Chain('c4a1e300', 'sminos');
    c.prompt('Older words.');
    c.answer('Older answer.');
    const older = c.rows.splice(0);
    c.prompt('Newer words.');
    let reads = 0;
    const { fake, transcript, plane, close } = await opened({ 'laneA.read': () => (++reads === 1 ? { ok: false, code: 'failed', message: 'mini isn’t reachable' } : { ok: true, result: { requested: true } }) });
    plane([snapshot(c.rows, true)]);
    await wait(() => user('Newer words.') !== undefined);
    const before = c.rows[0].uuid;
    transcript.loadOlder();
    await wait(() => transcript.state.getState().olderFailed !== null);
    expect(transcript.state.getState()).toMatchObject({ phase: 'live', loadingOlder: false, olderFailed: 'mini isn’t reachable' });
    c.answer('After the resume.'); // the replay resume: the watch's numbering goes on, with no reset and no snapshot
    plane([envelope('row', { row: c.rows.at(-1), agentId: null })]);
    await wait(() => reads === 2);
    expect(transcript.state.getState()).toMatchObject({ loadingOlder: true, olderFailed: null });
    expect(fake.invoked('laneA.read').map((input) => (input as { args: unknown }).args)).toEqual([{ before, limit: 100 }, { before, limit: 100 }]);
    plane([envelope('rows', { rows: [...older].reverse(), before, more: false })]);
    await wait(() => user('Older words.') !== undefined);
    expect(transcript.state.getState()).toMatchObject({ loadingOlder: false, more: false, olderFailed: null });
    close();
  });

  // Fix wave 2: an idle session whose link paused and resumed sends no DX4 data after the resume; main's `resumed` is
  // the signal, and it is never a discontinuity (no reset, the phase stays live, the rows stay drawn).
  it('asks a failed page again on a quiet resume of the link, with no further plane data, and draws it', async () => {
    const c = new Chain('c4a1e400', 'sminos');
    c.prompt('Older words.');
    c.answer('Older answer.');
    const older = c.rows.splice(0);
    c.prompt('Newer words.');
    let reads = 0;
    const { fake, transcript, plane, close } = await opened({ 'laneA.read': () => (++reads === 1 ? { ok: false, code: 'failed', message: 'mini isn’t reachable' } : { ok: true, result: { requested: true } }) });
    plane([snapshot(c.rows, true)]); // one prompt: the pane is underfilled, and asks at once
    await wait(() => user('Newer words.') !== undefined);
    const before = c.rows[0].uuid;
    transcript.loadOlder();
    await wait(() => transcript.state.getState().olderFailed !== null);
    const signal = (payload: Record<string, unknown>) => fake.event('laneA.plane', { appSessionId: APP, watch: 'w1', ...payload }, OTHER_MACHINE);
    signal({ paused: 'offline' });
    expect(reads).toBe(1);
    signal({ resumed: true });
    await wait(() => reads === 2);
    expect(transcript.state.getState()).toMatchObject({ phase: 'live', loadingOlder: true, olderFailed: null });
    expect(user('Newer words.')).toBeDefined();
    plane([envelope('rows', { rows: [...older].reverse(), before, more: false })]);
    await wait(() => user('Older words.') !== undefined);
    expect(transcript.state.getState()).toMatchObject({ phase: 'live', loadingOlder: false, more: false, olderFailed: null });
    close();
  });

  it('keeps its rows through a reset, and merges the fresh snapshot after it', async () => {
    const c = new Chain('c4a1e200', 'sminos');
    c.prompt('Before the drop.');
    const { fake, transcript, plane, close } = await opened();
    plane([snapshot(c.rows)]);
    await wait(() => user('Before the drop.') !== undefined);
    fake.event('laneA.plane', { appSessionId: APP, watch: 'w1', reset: true }, OTHER_MACHINE);
    expect(transcript.state.getState().phase).toBe('reconnecting');
    expect(user('Before the drop.')).toBeDefined();
    c.answer('After the drop.');
    plane([snapshot(c.rows)]);
    await wait(() => drawn().some((row) => row.kind === 'assistant_text'));
    expect(transcript.state.getState().phase).toBe('live');
    expect(user('Before the drop.')).toBeDefined();
    close();
  });

});

// 2026-11-06 (the remote lane A drill-in): a subagent's own transcript of another machine's terminal session is a watch
// of its own naming the agent (main subscribes with `rl2.agent-scope`), drawn under `<address>:<agent>` as the agent's
// transcript; its older rows are asked of that watch, a reset keeps what it drew, and when the machine gives nothing the
// transcript says why: the watch refused, or the machine's pause before its first snapshot.
describe('a remote lane A subagent’s own transcript', () => {
  const AGENT = 'a1';
  const KEY = `${APP}:${AGENT}`;
  const agentEnvelope = (kind: string, body: unknown) => ({ ...envelope(kind, body, 'up-a'), ...(kind === 'snapshot' && { n: 0 }) }) as SessionMessage;
  const agentSnapshot = (rows: JsonObject[], more = false) => agentEnvelope('snapshot', { rows: [...rows].reverse(), more, subagents: [], presence: { record: { status: 'idle' }, bridge: true, launch: 'L1' }, streaming: [] });
  const agentDrawn = () => useTranscriptStore.getState().entries[KEY]?.rows ?? [];
  const agentUser = (text: string) => agentDrawn().find((row): row is User => row.kind === 'user' && row.text === text);

  async function agentOpened(given: Parameters<typeof fakeClient>[0] = {}) {
    const fake = fakeClient({ 'laneA.watch': (input: { agentId?: string }) => ({ watch: input.agentId === undefined ? 'w1' : `w-${input.agentId}` }), 'laneA.read': { ok: true, result: { requested: true } }, ...given });
    const held = remoteAgentTranscriptOf(APP, AGENT, fake.client);
    const release = holdRemoteAgentTranscript(APP, AGENT, held);
    const unmount = mount(held.transcript, useTranscriptStore);
    await settle();
    const plane = (messages: SessionMessage[]) => fake.event('laneA.plane', { appSessionId: APP, watch: `w-${AGENT}`, messages }, OTHER_MACHINE);
    return { fake, ...held, plane, close: () => (unmount(), release()) };
  }

  it('opens a watch naming the agent and draws its own snapshot and live rows under the agent’s key', async () => {
    const c = new Chain('c4a1e500', 'sminos');
    c.prompt('Survey the checkout.');
    const { fake, transcript, plane, close } = await agentOpened();
    expect(fake.invoked('laneA.watch')).toEqual([{ appSessionId: APP, agentId: AGENT }]);
    expect(transcript.key).toBe(KEY);
    plane([agentSnapshot(c.rows)]);
    c.answer('One file.');
    plane([agentEnvelope('row', { row: c.rows.at(-1), agentId: AGENT })]);
    await wait(() => agentDrawn().some((row) => row.kind === 'assistant_text'));
    expect(agentUser('Survey the checkout.')).toBeDefined();
    expect(agentDrawn().find((row) => row.kind === 'assistant_text')).toMatchObject({ markdown: 'One file.' });
    expect(drawn()).toEqual([]); // nothing of the session's own transcript
    close();
  });

  it('asks older rows of the agent’s own watch and draws them before the held ones; a reset keeps what it drew', async () => {
    const c = new Chain('c4a1e600', 'sminos');
    c.prompt('Older words.');
    c.answer('Older answer.');
    const older = c.rows.splice(0);
    c.prompt('Newer words.');
    const { fake, transcript, plane, close } = await agentOpened();
    plane([agentSnapshot(c.rows, true)]);
    await wait(() => agentUser('Newer words.') !== undefined);
    transcript.loadOlder();
    await wait(() => fake.invoked('laneA.read').length > 0);
    expect(fake.invoked('laneA.read')).toEqual([{ appSessionId: APP, watch: `w-${AGENT}`, kind: 'rows', args: { before: c.rows[0].uuid, limit: 100 } }]);
    plane([agentEnvelope('rows', { rows: [...older].reverse(), before: c.rows[0].uuid, more: false })]);
    await wait(() => agentUser('Older words.') !== undefined);
    fake.event('laneA.plane', { appSessionId: APP, watch: `w-${AGENT}`, reset: true }, OTHER_MACHINE);
    expect(transcript.state.getState().phase).toBe('reconnecting');
    expect(agentUser('Newer words.')).toBeDefined();
    c.answer('After the reset.');
    plane([agentSnapshot(c.rows)]);
    await wait(() => agentDrawn().some((row) => row.kind === 'assistant_text' && row.markdown === 'After the reset.'));
    expect(agentDrawn().filter((row) => row.kind === 'user').map((row) => (row as User).text)).toEqual(['Older words.', 'Newer words.']);
    close();
  });

  it('says why it shows nothing: main’s refusal of the watch, or the machine’s pause before its first snapshot, cleared by what it gives', async () => {
    const refused = fakeClient();
    const held = remoteAgentTranscriptOf(APP, AGENT, refused.client);
    const release = holdRemoteAgentTranscript(APP, AGENT, held);
    await refused.fail('laneA.watch', 'mini can’t send it yet; update MAWS on mini');
    expect(held.unserved.getState()).toEqual({ why: { kind: 'refused', reason: 'mini can’t send it yet; update MAWS on mini' } });
    release();
    resetRemoteTranscripts();
    resetLaneAWatches();

    const c = new Chain('c4a1e700', 'sminos');
    c.prompt('Late words.');
    const { fake, unserved, plane, close } = await agentOpened();
    fake.event('laneA.plane', { appSessionId: APP, watch: `w-${AGENT}`, paused: 'unavailable' }, OTHER_MACHINE);
    expect(unserved.getState()).toEqual({ why: { kind: 'paused', reason: 'unavailable' } });
    plane([agentSnapshot(c.rows)]);
    expect(unserved.getState()).toEqual({ why: null });
    close();
  });
});

// Pre-flight item 6: a remote send is `sminos.send`, the machine's bridge's `deliver`. It writes the words as a row of
// the plugin's own (no frame: MAWS's key is no log writer's) and logs its mirror line; after a stop, its wake opens the
// turn that answers them. Through the remote source (the plane path, not the disk reader), each draws as the person's
// words and neither the mirror line nor anything else of the delivery as a notice.
describe('a send from MAWS that the remote bridge delivered', () => {
  it('into a running turn: the person’s words in that turn, the mirror line not drawn', async () => {
    const c = new Chain('c4a1e300', 'sminos');
    c.prompt('count slowly to 30, one line each');
    c.assistant([{ type: 'thinking', thinking: 'Counting.', signature: 'sig' }]);
    const { plane, close } = await opened();
    plane([snapshot(c.rows)]);
    const words = c.appended('and count them');
    const mirror = c.mirror('delivered', 'and count them');
    plane([envelope('row', { row: words, agentId: null }), envelope('row', { row: mirror, agentId: null })]);
    await wait(() => user('and count them') !== undefined);
    expect(user('and count them')).toMatchObject({ messageUuid: words.uuid, dropped: false });
    expect(drawn().some((row) => JSON.stringify(row).includes('sminos: delivered'))).toBe(false);
    expect(notices()).toEqual([]);
    close();
  });

  it('after a stop: the words open the turn the bridge’s wake starts, never a notice', async () => {
    const c = new Chain('c4a1e400', 'sminos');
    c.prompt('count slowly to 300, one line each');
    c.assistant([{ type: 'thinking', thinking: 'Counting.', signature: 'sig' }]);
    c.appended('[Request interrupted by user]');
    c.appended('The interrupt came from outside the terminal.');
    const words = c.appended('and count them');
    c.mirror('delivered', 'and count them');
    c.inboxWake(wakeAfterStop([]));
    c.answer('1, 2, 3.');
    c.end();
    const { plane, close } = await opened();
    plane([snapshot(c.rows)]);
    await wait(() => user('and count them') !== undefined);
    const bubble = user('and count them')!;
    expect(bubble).toMatchObject({ messageUuid: words.uuid, steer: false, dropped: false });
    expect(bubble.turnId).toBe(drawn().find((row) => row.kind === 'assistant_text' && row.markdown === '1, 2, 3.')?.turnId);
    expect(drawn().some((row) => JSON.stringify(row).includes('sminos: delivered'))).toBe(false);
    close();
  });
});

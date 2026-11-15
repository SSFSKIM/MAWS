// UX wave U1c, M4's prerequisite (the U1c document, M4, "A prerequisite before any TERMINAL_OFFERED value turns true";
// Decision Log 35): what a grant out holds of its session. Another machine's terminal session draws through the page's
// plane transcript of it, held by its pane (`holdRemoteTranscript`, whose last release closes the machine's watch), and
// through a source the plane replaces at each rebuild, which the pane attaches again. The hold keeps both: the machine's
// watch open and the transcript attached to the source that is current, whatever is mounted, until it lets go.
import type { JsonObject, SessionMessage } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { holdRemoteTranscript, remoteTranscriptOf, resetRemoteTranscripts } from '../lane-a/remote-source';
import { Chain, SESSION } from '../lane-a/test-support/chain-rows';
import { mount, settle } from '../lane-a/test-support/fake-plane';
import { resetLaneAWatches } from '../lane-a/watches';
import { resetLaneAStore } from '../stores/lane-a';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { holdSession } from './hold';

const APP = addressOf(OTHER_MACHINE, SESSION as AppSessionId);

let n = 0;
const envelope = (kind: string, body: unknown): SessionMessage =>
  ({ project: 'p', machine: OTHER_MACHINE, session: SESSION, kind, sub: 'up-1', n: kind === 'snapshot' ? 0 : ++n, body }) as SessionMessage;
const snapshot = (rows: JsonObject[]) => envelope('snapshot', { rows: [...rows].reverse(), more: false, subagents: [], presence: { record: { status: 'idle' }, bridge: true, launch: 'L1' }, streaming: [] });

let fake: FakeClient;
beforeEach(() => {
  n = 0;
  resetLaneAStore();
  resetLaneAWatches();
  resetRemoteTranscripts();
  resetQueueStore();
  useTranscriptStore.setState({ entries: {} });
  useSessions.setState({ records: new Map(), listed: new Map([[APP, { ...remoteRow(OTHER_MACHINE, SESSION, { lane: 'A', availability: 'foreign_held' }), appId: APP }]]) });
  fake = fakeClient({ 'laneA.watch': { watch: 'w1' }, 'laneA.read': { ok: true, result: { requested: true } }, 'session.queue.list': { entries: [], paused: false } });
  window.maws = fake.client as unknown as PreloadBridge; // the hold's own reads (the queue's) go through the page's client
});
afterEach(() => {
  resetRemoteTranscripts();
  resetLaneAWatches();
  resetQueueStore();
  delete (window as { maws?: PreloadBridge }).maws;
});

/** The session's pane as `RemoteTranscriptSlot` mounts it: the plane transcript held, its current source attached. */
async function pane() {
  const transcript = remoteTranscriptOf(APP, fake.client);
  const release = holdRemoteTranscript(APP, transcript);
  const unmount = mount(transcript, useTranscriptStore);
  await settle();
  return { transcript, close: () => (unmount(), release()) };
}
const plane = (messages: SessionMessage[]) => fake.event('laneA.plane', { appSessionId: APP, watch: 'w1', messages }, OTHER_MACHINE);
const answers = () => (useTranscriptStore.getState().entries[APP]?.rows ?? []).flatMap((row) => (row.kind === 'assistant_text' ? [row.markdown] : []));
const attached = () => useTranscriptStore.getState().attached(APP);
const unwatched = () => fake.invoked('laneA.unwatch').length;
const wait = async (ok: () => boolean) => {
  for (let i = 0; i < 50 && !ok(); i++) await settle();
};
/** A row the machine writes after what is held, delivered live. */
const written = (c: Chain, text: string) => {
  c.answer(text);
  plane([envelope('row', { row: c.rows.at(-1), agentId: null })]);
};

describe('what a grant out holds of another machine’s terminal session (M4’s prerequisite; Decision Log 35)', () => {
  it('the pane closed with a grant out: the machine’s watch stays open and the transcript attached; a row written after the close reaches the store', async () => {
    const c = new Chain('c4a1f000', 'sminos');
    c.prompt('Run the build.');
    const view = await pane();
    plane([snapshot(c.rows)]);
    await wait(() => (useTranscriptStore.getState().entries[APP]?.rows.length ?? 0) > 0);
    const release = holdSession(APP);
    await settle();
    view.close();
    await settle();
    expect(attached(), 'attached after the pane closed').toBe(true);
    expect(unwatched(), 'the machine’s watch stays open').toBe(0);
    written(c, 'Built after the close.');
    await wait(() => answers().length > 0);
    expect(answers()).toEqual(['Built after the close.']);
    release();
    await settle();
    expect(attached(), 'let go: nothing attached').toBe(false);
    expect(unwatched(), 'let go: the watch closed').toBe(1);
  });

  it('a plane rebuild with a grant out, the pane open, then the pane closed: the transcript stays attached to the rebuilt source and follows it', async () => {
    const c = new Chain('c4a1f100', 'sminos');
    c.prompt('Run the build.');
    const view = await pane();
    plane([snapshot(c.rows)]);
    await wait(() => (useTranscriptStore.getState().entries[APP]?.rows.length ?? 0) > 0);
    const release = holdSession(APP);
    await settle();
    const before = view.transcript.state.getState().source;
    plane([snapshot(c.rows)]); // a fresh snapshot over held rows: the plane rebuilds under a new source, and the pane attaches it
    await wait(() => view.transcript.state.getState().source !== before);
    await settle();
    view.close();
    await settle();
    expect(attached(), 'attached after the replacement and the pane’s close').toBe(true);
    written(c, 'Built after the rebuild.');
    await wait(() => answers().length > 0);
    expect(answers()).toEqual(['Built after the rebuild.']);
    release();
    await settle();
    expect(attached()).toBe(false);
  });

  it('a plane rebuild with a grant out and the pane closed: the hold attaches the rebuilt source, and what the machine writes after it reaches the store', async () => {
    const c = new Chain('c4a1f200', 'sminos');
    c.prompt('Run the build.');
    const view = await pane();
    plane([snapshot(c.rows)]);
    await wait(() => (useTranscriptStore.getState().entries[APP]?.rows.length ?? 0) > 0);
    const release = holdSession(APP);
    await settle();
    view.close();
    await settle();
    const before = view.transcript.state.getState().source;
    fake.event('laneA.plane', { appSessionId: APP, watch: 'w1', reset: true }, OTHER_MACHINE); // the link dropped: a fresh snapshot follows
    plane([snapshot(c.rows)]);
    await wait(() => view.transcript.state.getState().source !== before);
    await settle();
    expect(attached()).toBe(true);
    written(c, 'Built after the reset.');
    await wait(() => answers().length > 0);
    expect(answers()).toEqual(['Built after the reset.']);
    release();
    await settle();
    expect(attached()).toBe(false);
    expect(unwatched()).toBe(1);
  });

  it('the release with the pane open lets go of the hold only: the pane’s transcript stays attached and its watch open, and a row still reaches it', async () => {
    const c = new Chain('c4a1f300', 'sminos');
    c.prompt('Run the build.');
    const view = await pane();
    plane([snapshot(c.rows)]);
    await wait(() => (useTranscriptStore.getState().entries[APP]?.rows.length ?? 0) > 0);
    const release = holdSession(APP);
    await settle();
    plane([snapshot(c.rows)]); // a rebuild while held: the pane attaches the new source
    await settle();
    await settle();
    release();
    await settle();
    expect(attached()).toBe(true);
    expect(unwatched()).toBe(0);
    written(c, 'Still drawn.');
    await wait(() => answers().length > 0);
    expect(answers()).toEqual(['Still drawn.']);
    view.close();
    await settle();
    expect(attached()).toBe(false);
    expect(unwatched()).toBe(1);
  });
});

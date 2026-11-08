import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { MawsBridge } from '@shared/ipc/schema';
import { useTranscriptStore } from '../../stores/transcript';
import { useNotices } from '../../stores/notices';
import { memoryTargetLabel, memoryTargetOptions } from '../modes/memory';
import type { Serialized } from './serialize';
import { submitHumanSerialized, submitSerialized } from './submit';
import { addressOf } from '@shared/machine/address'; // board #525
import { remoteRow } from '../../../../../test/support/builders'; // board #525
import { OTHER_MACHINE } from '../../../../../test/support/machine'; // board #525
import type { SessionControls } from '../../session/controls/types'; // board #525
import { learnReaderGrade, resetReader, useReader } from '../../sessions/share/reader'; // board #525
import { useSessions } from '../../stores/sessions'; // board #525
import { controlsFor } from '../../session/controls/controls-for'; // board #525
import { laneAState } from '../../lane-a/test-support/lane-a-state'; // board #525
import { fakeClient } from '../../../../../test/support/fake-client'; // board #525

const APP = 'app-1' as AppSessionId;

function client(answers: Record<string, unknown> = {}) {
  const calls: [string, unknown][] = [];
  const bridge = {
    invoke: vi.fn(async (name: string, input: unknown) => {
      calls.push([name, input]);
      return name in answers ? answers[name] : { ok: true, value: name === 'session.memoryAppend' ? { path: '/repo/CLAUDE.md', created: false } : undefined };
    }),
    on: () => () => {},
    pathForFile: () => '',
  } as unknown as MawsBridge;
  return { bridge, calls };
}

const serialized = (over: Partial<Serialized>): Serialized => ({ mode: 'send', text: 'hi', content: 'hi', display: 'hi', pastedContents: {}, omitted: 0, empty: false, ...over });
const toasts = () => useNotices.getState().notices.map((n) => n.text);

beforeEach(() => useNotices.setState({ notices: [] }));

describe('the editor submits by mode and records history', () => {
  it('only an accepted prompt restores transcript follow, not a refusal or a memory save', async () => {
    const store = useTranscriptStore.getState();
    await store.attach(APP, { key: APP, snapshot: async () => [], subscribe: () => () => {} });
    const { bridge } = client();
    try {
      store.setFollowing(APP, false);
      const request = useTranscriptStore.getState().entries[APP].sendFollowRequest;
      await submitSerialized(bridge, APP, serialized({}), 'send', null, { dispatch: async () => 'refused' });
      expect(useTranscriptStore.getState().entries[APP].following).toBe(false);
      expect(useTranscriptStore.getState().entries[APP].sendFollowRequest).toBe(request);
      await submitSerialized(bridge, APP, serialized({ mode: 'memory' }), 'send', null);
      await submitSerialized(bridge, APP, serialized({ mode: 'bash' }), 'send', null);
      expect(useTranscriptStore.getState().entries[APP].following).toBe(false);
      expect(useTranscriptStore.getState().entries[APP].sendFollowRequest).toBe(request);
      await submitSerialized(bridge, APP, serialized({}), 'send', null);
      expect(useTranscriptStore.getState().entries[APP].following).toBe(true);
      expect(useTranscriptStore.getState().entries[APP].sendFollowRequest).toBe(request + 1);
      await submitSerialized(bridge, APP, serialized({}), 'steer', null);
      expect(useTranscriptStore.getState().entries[APP].sendFollowRequest).toBe(request + 2);
    } finally { store.drop(APP); }
  });

  it('sends, steers into the running turn, and appends the display to history', async () => {
    const { bridge, calls } = client();
    expect(await submitSerialized(bridge, APP, serialized({ pastedContents: { '1': { id: 1, type: 'text', content: 'b', contentHash: null, mediaType: null, filename: null } } }), 'send', null)).toBe(true);
    expect(await submitSerialized(bridge, APP, serialized({ content: 'more' }), 'steer', null)).toBe(true);
    expect(calls).toEqual([
      ['session.send', { appSessionId: APP, content: 'hi' }],
      ['session.history.append', { appSessionId: APP, display: 'hi', pastedContents: { '1': { id: 1, type: 'text', content: 'b', contentHash: null, mediaType: null, filename: null } } }],
      ['session.steer', { appSessionId: APP, content: 'more', priority: 'next' }],
      ['session.history.append', { appSessionId: APP, display: 'hi', pastedContents: {} }],
    ]);
  });

  it('runs a shell command through the engine and saves a memory note, each into history as typed', async () => {
    const { bridge, calls } = client();
    await submitSerialized(bridge, APP, serialized({ mode: 'bash', text: 'ls -la', content: 'ls -la', display: '!ls -la' }), 'send', null);
    await submitSerialized(bridge, APP, serialized({ mode: 'memory', text: 'note', content: 'note', display: '#note' }), 'send', { kind: 'path', path: '/repo/docs/CLAUDE.md' });
    expect(calls).toEqual([
      ['session.bash', { appSessionId: APP, command: 'ls -la' }],
      ['session.history.append', { appSessionId: APP, display: '!ls -la', pastedContents: {} }],
      ['session.memoryAppend', { appSessionId: APP, text: 'note', target: { kind: 'path', path: '/repo/docs/CLAUDE.md' } }],
      ['session.history.append', { appSessionId: APP, display: '#note', pastedContents: {} }],
    ]);
    expect(toasts()).toEqual(['Saved to /repo/CLAUDE.md']);
  });

  it('keeps the text on a refusal: nothing recorded, the host’s message shown', async () => {
    const { bridge, calls } = client({ 'session.memoryAppend': { ok: false, error: ipcError('internal', 'the folder is gone') } });
    expect(await submitSerialized(bridge, APP, serialized({ mode: 'memory', text: 'n', content: 'n', display: '#n' }), 'send', null)).toBe(false);
    expect(calls.map((c) => c[0])).toEqual(['session.memoryAppend']);
    expect(toasts()).toEqual(['the folder is gone']);
  });

  it('refuses an oversized message before writing and reports left-out pasted segments', async () => {
    const { bridge, calls } = client();
    expect(await submitSerialized(bridge, APP, serialized({ content: 'x'.repeat(1024 * 1024 + 1) }), 'send', null)).toBe(false);
    expect(calls).toEqual([]);
    expect(toasts()[0]).toMatch(/^Message too large/);
    await submitSerialized(bridge, APP, serialized({ omitted: 1 }), 'send', null);
    await submitSerialized(bridge, APP, serialized({ omitted: 2 }), 'send', null);
    expect(toasts().slice(1)).toEqual(['1 pasted segment was unavailable and was left out', '2 pasted segments were unavailable and were left out']);
  });

  it("runs a caller's dispatch between the same pre-check and after-acceptance steps, and offers Retry on its refusal", async () => {
    const { bridge, calls } = client();
    const dispatch = vi.fn(async () => null);
    expect(await submitSerialized(bridge, APP, serialized({ omitted: 1 }), 'send', null, { dispatch, project: '/repo/new' })).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([['session.history.append', { appSessionId: APP, display: 'hi', pastedContents: {}, project: '/repo/new' }]]); // the default dispatch never ran
    expect(toasts()).toEqual(['1 pasted segment was unavailable and was left out']);

    expect(await submitSerialized(bridge, APP, serialized({ content: 'x'.repeat(1024 * 1024 + 1) }), 'send', null, { dispatch })).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1); // the pre-check refused before any dispatch

    const retry = vi.fn();
    expect(await submitSerialized(bridge, APP, serialized({}), 'send', null, { dispatch: async () => 'refused', retry })).toBe(false);
    const refused = useNotices.getState().notices.at(-1)!;
    expect(refused.text).toBe('refused');
    expect(refused.actions.map((a) => a.label)).toEqual(['Retry']);
    refused.actions[0].run();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(useNotices.getState().notices.some((n) => n.id === refused.id)).toBe(false); // Retry takes its toast away
    expect(calls.filter((c) => c[0] === 'session.history.append')).toHaveLength(1);
  });

  it('does nothing for an empty draft', async () => {
    const { bridge, calls } = client();
    expect(await submitSerialized(bridge, APP, serialized({ empty: true }), 'send', null)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('the # target menu', () => {
  it('offers the project and user files and every listed path, a missing one as a new file', () => {
    const files = [
      { kind: 'project', path: '/repo/CLAUDE.md', label: 'Project memory', description: '', exists: true },
      { kind: 'user', path: '/home/.claude/CLAUDE.md', label: 'User memory', description: '', exists: true },
      { kind: 'local', path: '/repo/docs/CLAUDE.md', label: 'docs/CLAUDE.md', description: '', exists: false },
    ];
    expect(memoryTargetOptions(files)).toEqual([
      { target: { kind: 'project', path: null }, label: 'Project memory', detail: '/repo/CLAUDE.md' },
      { target: { kind: 'user', path: null }, label: 'User memory', detail: '/home/.claude/CLAUDE.md' },
      { target: { kind: 'path', path: '/repo/docs/CLAUDE.md' }, label: 'docs/CLAUDE.md', detail: 'new file' },
    ]);
    expect(memoryTargetLabel({ kind: 'project', path: null }, files)).toBe('Project memory');
    expect(memoryTargetLabel({ kind: 'path', path: '/elsewhere/CLAUDE.md' }, [])).toBe('/elsewhere/CLAUDE.md');
    expect(memoryTargetLabel({ kind: 'user', path: null }, [])).toBe('User memory');
  });
});

// Board #525: another machine's terminal session has no record, and a send it refused is said all the same, never
// nothing; one refused at the member's grade there offers no Retry. An unstarted session with no record stays quiet. A
// prompt the host took for another member's session is kept as the member's own.
describe('a session on another machine with no record', () => {
  const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
  const port = (result: object) => ({ send: vi.fn(async () => result) }) as unknown as SessionControls;
  const actions = () => useNotices.getState().notices.map((n) => n.actions.map((a) => a.label));
  beforeEach(() => {
    resetReader();
    useSessions.setState({ records: new Map(), listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A', owners: ['member-ana'], mine: false }), appId: REMOTE }]]), member: 'member-me' });
  });

  it('says a refused send, with Retry, and without it once the member’s grade there refused it', async () => {
    const { bridge } = client();
    const retry = () => {};
    expect(await submitHumanSerialized(port({ disposition: 'refused', started: false, reason: 'mini isn’t reachable' }), bridge, REMOTE, serialized({}), retry)).toBe(false);
    expect(toasts()).toEqual(['mini isn’t reachable']);
    expect(actions()[0]).toHaveLength(1);
    useNotices.setState({ notices: [] });
    learnReaderGrade(REMOTE, 'view');
    await submitHumanSerialized(port({ disposition: 'refused', started: false, reason: 'Not sent: no' }), bridge, REMOTE, serialized({}), retry);
    expect(toasts()).toEqual(['Not sent: no']);
    expect(actions()[0]).toEqual([]);
  });

  it('stays quiet for a session that is neither recorded nor on another machine', async () => {
    const { bridge } = client();
    await submitHumanSerialized(port({ disposition: 'refused', started: false, reason: 'held' }), bridge, 'app-unstarted' as AppSessionId, serialized({}));
    expect(toasts()).toEqual([]);
  });

  // The port keeps what the host took as the member's own (controls-for.ts), so the composer's submit does not: a port
  // handed to it directly notes nothing, one from `controlsFor` does, whoever sends.
  it('leaves keeping the member’s own prompt to the port', async () => {
    const { bridge } = client();
    expect(await submitHumanSerialized(port({ disposition: 'sent', started: false, messageUuid: 'uuid-sent' }), bridge, REMOTE, serialized({}))).toBe(true);
    expect(useReader.getState().sent.size).toBe(0);
    const link = { state: 'up', refusal: null, carrier: 'direct', member: 'member-me', clientClass: 'native-mac', rights: [], reason: null } as const;
    const fake = fakeClient({ 'laneA.send': { key: { writer: 'maws/m', seq: 1 }, state: 'entered', uuid: 'uuid-port' } });
    const real = controlsFor(null, laneAState(REMOTE, { link, acts: [] }), { appSessionId: REMOTE, client: fake.client })!;
    expect(await submitHumanSerialized(real, bridge, REMOTE, serialized({}))).toBe(true);
    expect(useReader.getState().sent.get(REMOTE)).toEqual(new Set(['uuid-port']));
  });
});


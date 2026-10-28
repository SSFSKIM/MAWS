// Main's wiring of the owner channel's launch half: `mods.*` registered over the index with the app's switch from
// settings, the config home from the engine's environment, and the host's event batches feeding the mismatch check.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import type { Settings } from '@shared/ipc/schema/settings';
import type { HostState } from '@shared/ipc/schema';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { HostEvents } from '../sessions/context';
import { installToHumanPlugin } from '../../../test/support/to-human-plugin';
import { startOwnerChannel } from './register';

const SUPPLEMENTED = 'external-style-plus-supplement' as const;
const SUPP = 'supplement:3' as const;

describe('startOwnerChannel', () => {
  let root: string;
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let settings: Settings;
  let a: AppSessionId;
  const handlers = new Map<string, (input: unknown) => unknown>();
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const fire = (name: string, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));
  const projected: { appSessionId: string; items: AttentionItem[]; silent: readonly string[] }[] = [];
  const hostStates = new Set<(state: HostState) => void>();
  const streamings = new Set<() => void>();
  const settingsListeners = new Set<() => void>();
  const emitted: unknown[] = [];
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-owner-register-')));
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    a = index.sessions.upsertFromSummary(summary({ directory: root })).record.appId;
    settings = structuredClone(SETTINGS_DEFAULTS_V19);
    handlers.clear();
    listeners.clear();
    projected.length = 0;
    emitted.length = 0;
    hostStates.clear();
    streamings.clear();
    settingsListeners.clear();
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const start = () =>
    startOwnerChannel({
      index,
      settings: () => settings,
      engineEnv: Promise.resolve({ HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: join(root, 'engine-config') }),
      onEvent: ((name: string, listener: (payload: unknown) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), listener]);
        return () => listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== listener));
      }) as HostEvents,
      register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
      log: () => {},
      // M4
      attention: { setOwnerItems: (appSessionId, items, silent) => void projected.push({ appSessionId, items, silent }) },
      dispatch: async () => ({ ok: false, error: { code: 'internal', message: 'no host' } }),
      onHostState: (listener) => (hostStates.add(listener), () => void hostStates.delete(listener)),
      onStreaming: (listener) => (streamings.add(listener), () => void streamings.delete(listener)),
      streaming: () => true,
      emit: (_name, payload) => void emitted.push(payload),
      onSettings: (listener) => (settingsListeners.add(listener), () => void settingsListeners.delete(listener)),
    });

  // P4-R7z: the to-human plugin's style (it declares 6, its message tool), the one that carries the lane
  const pluginStyle = () => installToHumanPlugin(join(root, 'engine-config'));

  it('registers mods.* and ownerChannel.* over the index, the app switch read from settings at each call', async () => {
    pluginStyle();
    start();
    expect([...handlers.keys()].sort()).toEqual(['mods.list', 'mods.setSessionOverride', 'ownerChannel.answered', 'ownerChannel.cancel', 'ownerChannel.markRead', 'ownerChannel.state']);
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ id: 'maws.to-human', enabled: true, source: SUPPLEMENTED }]);
    settings = { ...settings, mods: { toHuman: { enabled: false } } };
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ enabled: false, source: 'off' }]);
    handlers.get('mods.setSessionOverride')!({ appSessionId: a, id: 'maws.to-human', value: 'on' });
    expect(await handlers.get('mods.list')!({ appSessionId: a })).toMatchObject([{ enabled: false, perSession: 'on', source: SUPPLEMENTED, pending: 'next-launch' }]);
  });

  it('reads the user style from the engine’s config home', async () => {
    start();
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ source: 'off' }]); // the default style carries no lane
    pluginStyle();
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ source: SUPPLEMENTED }]);
  });

  // P4-R7z: a launch that found the lane on under a style without the plugin's tool leaves the lane nothing to carry, so
  // the session's state reads it off and its marks raise no items, whatever its switch says
  it('a session whose last launch’s style carries no lane reads its lane off and raises no items, not even once a launch carries it', () => {
    const { launches } = start();
    const decision = (desired: typeof SUPPLEMENTED | 'off') => ({
      appSessionId: a, kind: 'resume' as const, laneOn: true, override: 'inherit' as const, desired, recorded: 'unrecorded' as const, appended: desired !== 'off', snapshotOff: false, offUnavailable: false,
      applied: desired, style: desired === 'off' ? 'default' : 'doperpowers:to-human', decidedBy: desired === 'off' ? 'default' : 'doperpowers:to-human', styleUnresolved: null,
    });
    launches.launched(decision('off'), { launchId: 'l1', at: '2026-10-09T09:00:00.000Z' });
    const block = {
      id: 'e1', sessionId: 's', at: '2026-10-09T10:00:00.000Z', seq: 3, agentId: null, parentToolUseId: null, kind: 'assistant.block.complete', messageUuid: '11111111-1111-4111-8111-111111111111',
      apiMessageId: 'msg_1', blockIndex: 0, block: { type: 'text', text: '<need-input>Which backend?</need-input>' }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [],
    } as unknown as SessionEvent;
    fire('session.eventBatch', { appSessionId: a, events: [block] });
    expect(handlers.get('ownerChannel.state')!({ appSessionId: a })).toMatchObject({ lane: { on: false, override: 'inherit', applied: 'off', pending: null } });
    expect(projected.at(-1)).toMatchObject({ appSessionId: a, items: [] });
    // a launch that carries the lane: its state reads on, and the question written without one is still no item
    launches.launched(decision(SUPPLEMENTED), { launchId: 'l2', at: '2026-10-09T11:00:00.000Z' });
    expect(handlers.get('ownerChannel.state')!({ appSessionId: a })).toMatchObject({ lane: { on: true, applied: SUPPLEMENTED, pending: null } });
    expect(projected.at(-1)).toMatchObject({ appSessionId: a, items: [] });
  });

  // P4-R7z: a decided launch can move the lane in effect, so its record projects the session's items again, silently
  it('a launch whose style carries no lane takes the session’s items away at once, silently', () => {
    const { launches } = start();
    index.ownerChannel.recordLaunch(a, { launchId: 'l1', at: '2026-10-09T09:00:00.000Z', laneOn: true, desired: SUPPLEMENTED, recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: SUPPLEMENTED, style: 'doperpowers:to-human' });
    const block = {
      id: 'e1', sessionId: 's', at: '2026-10-09T10:00:00.000Z', seq: 3, agentId: null, parentToolUseId: null, kind: 'assistant.block.complete', messageUuid: '11111111-1111-4111-8111-111111111111',
      apiMessageId: 'msg_1', blockIndex: 0, block: { type: 'text', text: '<need-input>Which backend?</need-input>' }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [],
    } as unknown as SessionEvent;
    fire('session.eventBatch', { appSessionId: a, events: [block] });
    expect(projected.at(-1)!.items.map((item) => item.kind)).toEqual(['async_input']);
    launches.launched(
      { appSessionId: a, kind: 'resume', laneOn: true, override: 'inherit', desired: 'off', recorded: SUPP, appended: false, snapshotOff: true, offUnavailable: false, applied: 'off', style: 'default', decidedBy: 'default', styleUnresolved: null },
      { launchId: 'l2', at: '2026-10-09T11:00:00.000Z' },
    );
    expect(projected.at(-1)).toMatchObject({ appSessionId: a, items: [] });
    expect(emitted.at(-1)).toMatchObject({ appSessionId: a, state: { lane: { on: false, applied: 'off' } } });
  });

  it('M4: feeds the host’s event batches to the marks, re-projects silently when the app switch or a session override moves, and stops listening', () => {
    index.ownerChannel.recordLaunch(a, { launchId: 'l1', at: '2026-10-09T09:00:00.000Z', laneOn: true, desired: SUPPLEMENTED, recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: SUPPLEMENTED, style: 'to-human' });
    const channel = start();
    const block = {
      id: 'e1', sessionId: 's', at: '2026-10-09T10:00:00.000Z', seq: 3, agentId: null, parentToolUseId: null, kind: 'assistant.block.complete', messageUuid: '11111111-1111-4111-8111-111111111111',
      apiMessageId: 'msg_1', blockIndex: 0, block: { type: 'text', text: '<need-input>Which backend?</need-input>' }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [],
    } as unknown as SessionEvent;
    fire('session.eventBatch', { appSessionId: a, events: [block] });
    expect(projected.at(-1)).toMatchObject({ appSessionId: a, items: [{ kind: 'async_input', summary: 'Question — Which backend?' }], silent: [] });
    expect(emitted).toHaveLength(1);
    settings = { ...settings, mods: { toHuman: { enabled: false } } };
    settingsListeners.forEach((listener) => listener());
    expect(projected.at(-1)).toMatchObject({ items: [], silent: [] });
    handlers.get('mods.setSessionOverride')!({ appSessionId: a, id: 'maws.to-human', value: 'on' });
    expect(projected.at(-1)!.items.map((i) => i.kind)).toEqual(['async_input']);
    expect(projected.at(-1)!.silent).toEqual([projected.at(-1)!.items[0]!.id]);
    expect(handlers.get('ownerChannel.state')!({ appSessionId: a })).toMatchObject({ lane: { on: true, override: 'on' }, marks: [{ head: 'Which backend?', question: { state: 'unanswered' } }] });
    channel.stop();
    expect([...hostStates, ...streamings, ...settingsListeners]).toEqual([]);
  });

  it('feeds the host’s event batches to the launches’ mismatch check, and states the session’s owner channel after each record', () => {
    const { launches } = start();
    // before its first decided launch the session's lane waits for it; the launch's record ends the wait, which the report
    // and the mods row learn from the owner channel's own event
    expect(handlers.get('ownerChannel.state')!({ appSessionId: a })).toMatchObject({ lane: { on: true, applied: null, pending: 'next-launch' } });
    launches.launched(
      { appSessionId: a, kind: 'new', laneOn: true, override: 'inherit', desired: SUPPLEMENTED, recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: SUPPLEMENTED, style: 'default', decidedBy: 'default', styleUnresolved: null },
      { launchId: 'l1', at: 't' },
    );
    expect(emitted.at(-1)).toMatchObject({ appSessionId: a, state: { lane: { on: true, applied: SUPPLEMENTED, pending: null, mismatch: null } } });
    const init = { id: 'e1', sessionId: 's', at: 't', seq: 1, agentId: null, parentToolUseId: null, kind: 'session.init', outputStyle: 'Explanatory' } as unknown as SessionEvent;
    fire('session.eventBatch', { appSessionId: a, events: [init] });
    expect(index.ownerChannel.session(a)).toMatchObject({ style: 'default', observedStyle: 'Explanatory', styleMismatch: true });
    expect(emitted.at(-1)).toMatchObject({ appSessionId: a, state: { lane: { mismatch: { resolved: 'default', observed: 'Explanatory' } } } });
  });

  it('feeds the host’s queue snapshots to the answers: a queued answer edited in the queue reads as edited', () => {
    index.ownerChannel.recordLaunch(a, { launchId: 'l1', at: '2026-10-09T09:00:00.000Z', laneOn: true, desired: SUPPLEMENTED, recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: SUPPLEMENTED, style: 'to-human' });
    const channel = start();
    const block = {
      id: 'e1', sessionId: 's', at: '2026-10-09T10:00:00.000Z', seq: 3, agentId: null, parentToolUseId: null, kind: 'assistant.block.complete', messageUuid: '11111111-1111-4111-8111-111111111111',
      apiMessageId: 'msg_1', blockIndex: 0, block: { type: 'text', text: '<need-input>Which backend?</need-input>' }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [],
    } as unknown as SessionEvent;
    fire('session.eventBatch', { appSessionId: a, events: [block] });
    const markId = (handlers.get('ownerChannel.state')!({ appSessionId: a }) as { marks: { id: string }[] }).marks[0]!.id;
    handlers.get('ownerChannel.answered')!({ appSessionId: a, markId, text: 'Answering "Which backend?": Postgres', origin: 'reply', disposition: 'queued', queueId: 'q1', started: false });
    const entry = { queueId: 'q1', appSessionId: a, content: 'Answering "Which backend?": SQLite', createdAt: 't', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    fire('session.queue', { appSessionId: a, entries: [entry], paused: false });
    expect(emitted.at(-1)).toMatchObject({ appSessionId: a, state: { marks: [{ question: { state: 'queued', text: 'Answering "Which backend?": SQLite' } }] } });
    channel.stop();
    expect(listeners.get('session.queue')).toEqual([]);
  });
});

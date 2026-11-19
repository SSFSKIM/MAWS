// Main's wiring of the owner channel's launch half: `mods.*` registered over the index with the app's switch from
// settings, the config home from the engine's environment, and the host's event batches feeding the mismatch check.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import type { Settings } from '@shared/ipc/schema/settings';
import type { HostState } from '@shared/ipc/schema';
import type { HostDispatch } from '@shared/host/host-supervisor';
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
  let summariesSaid: { summaries: boolean }[] = []; // panel finding 3: the switch's value as each word that it changed found it
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-owner-register-')));
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    a = index.sessions.upsertFromSummary(summary({ directory: root })).record.appId;
    settings = structuredClone(SETTINGS_DEFAULTS_V21);
    handlers.clear();
    listeners.clear();
    projected.length = 0;
    emitted.length = 0;
    hostStates.clear();
    streamings.clear();
    settingsListeners.clear();
    summariesSaid = [];
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const noHost: HostDispatch = async () => ({ ok: false, error: { code: 'internal', message: 'no host' } });
  const start = (dispatch: HostDispatch = noHost) =>
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
      dispatch,
      onHostState: (listener) => (hostStates.add(listener), () => void hostStates.delete(listener)),
      onStreaming: (listener) => (streamings.add(listener), () => void streamings.delete(listener)),
      streaming: () => true,
      emit: (_name, payload) => void emitted.push(payload),
      onSettings: (listener) => (settingsListeners.add(listener), () => void settingsListeners.delete(listener)),
      foldSummariesChanged: () => void summariesSaid.push({ summaries: index.ownerChannel.foldSummaries() }),
    });

  // P4-R7z: the to-human plugin's style (it declares 6, its message tool), the one that carries the lane
  const pluginStyle = () => installToHumanPlugin(join(root, 'engine-config'));

  it('registers mods.* and ownerChannel.* over the index, the app switch read from settings at each call', async () => {
    pluginStyle();
    start();
    expect([...handlers.keys()].sort()).toEqual(['mods.list', 'mods.setFoldSummaries', 'mods.setSessionOverride', 'ownerChannel.answered', 'ownerChannel.cancel', 'ownerChannel.folds', 'ownerChannel.markRead', 'ownerChannel.state']);
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
      advertised: desired === 'off' ? null : (8 as const), plugin: true, reserved: false, summariesOff: false, // U2b
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
      { appSessionId: a, kind: 'resume', laneOn: true, override: 'inherit', desired: 'off', recorded: SUPP, appended: false, snapshotOff: true, offUnavailable: false, applied: 'off', style: 'default', decidedBy: 'default', styleUnresolved: null, advertised: null, plugin: true, reserved: false, summariesOff: false },
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
      { appSessionId: a, kind: 'new', laneOn: true, override: 'inherit', desired: SUPPLEMENTED, recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: SUPPLEMENTED, style: 'default', decidedBy: 'default', styleUnresolved: null, advertised: 8, plugin: true, reserved: false, summariesOff: false },
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

  // The UX wave, U2b (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, §A, §M; M4)
  describe('who draws, the mod’s file of summaries and the summaries’ switch', () => {
    const ENGINE = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

    it('publishes drawnBy with every state: not known before the live statuses are read (mod), MAWS once the read lists no process for it', async () => {
      let answer!: () => void;
      const channel = start(async (_owner, name) =>
        name === 'engine.sessions' ? new Promise((resolve) => (answer = () => resolve({ ok: true, value: [] }))) : { ok: false, error: { code: 'internal', message: 'no host' } });
      expect(handlers.get('ownerChannel.state')!({ appSessionId: a })).toMatchObject({ lane: { drawnBy: 'mod' } }); // B12: not yet discovered
      answer();
      await channel.work.settled();
      expect(handlers.get('ownerChannel.state')!({ appSessionId: a })).toMatchObject({ lane: { drawnBy: 'maws' } }); // B1
      expect(emitted.at(-1)).toMatchObject({ appSessionId: a, state: { lane: { drawnBy: 'maws' } } });
    });

    it('answers ownerChannel.folds from the engine’s config home, by the session’s engine session id', async () => {
      const b = index.sessions.upsertFromSummary(summary({ sessionId: ENGINE as SessionId, directory: root })).record.appId;
      start();
      expect(await handlers.get('ownerChannel.folds')!({ appSessionId: b })).toEqual({ runs: [] });
      const folds = join(root, 'engine-config', 'to-human', 'folds');
      mkdirSync(folds, { recursive: true });
      writeFileSync(join(folds, `${ENGINE}.json`), JSON.stringify({ shape: 2, runs: [['toolu_1', 'toolu_3', 'Read the release notes; three breaking changes found']] }));
      expect(await handlers.get('ownerChannel.folds')!({ appSessionId: b })).toEqual({ runs: [{ first: 'toolu_1', last: 'toolu_3', summary: 'Read the release notes; three breaking changes found' }] });
      writeFileSync(join(folds, `${ENGINE}.json`), JSON.stringify({ shape: 1, runs: [['toolu_1', 'toolu_3', 'A file of a release before the contract']] }));
      expect(await handlers.get('ownerChannel.folds')!({ appSessionId: b })).toEqual({ runs: null });
    });

    it('writes the switch with mods.setFoldSummaries; two writes together leave the later, which mods.list answers', async () => {
      pluginStyle();
      start();
      expect(await handlers.get('mods.list')!({})).toMatchObject([{ summaries: true }]);
      await Promise.all([handlers.get('mods.setFoldSummaries')!({ on: true }), handlers.get('mods.setFoldSummaries')!({ on: false })]);
      expect(await handlers.get('mods.list')!({})).toMatchObject([{ summaries: false }]);
      expect(await handlers.get('mods.list')!({ appSessionId: a })).toMatchObject([{ summaries: false }]);
      await handlers.get('mods.setFoldSummaries')!({ on: true });
      expect(await handlers.get('mods.list')!({})).toMatchObject([{ summaries: true }]);
    });

    // Panel finding 3 (the coordinator's ruling): each write is said once, after it, so the lists that read again on
    // `mods.foldSummariesChanged` read what it wrote
    it('says each write of the switch once, after the write', async () => {
      start();
      await handlers.get('mods.setFoldSummaries')!({ on: false });
      await handlers.get('mods.setFoldSummaries')!({ on: true });
      expect(summariesSaid).toEqual([{ summaries: false }, { summaries: true }]);
    });
  });
});

// Main's wiring of the owner channel's launch half: `mods.*` registered over the index with the app's switch from
// settings, the config home from the engine's environment, and the host's event batches feeding the mismatch check.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import type { Settings } from '@shared/ipc/schema/settings';
import type { HostState } from '@shared/ipc/schema';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { HostEvents } from '../sessions/context';
import { startOwnerChannel } from './register';

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
    settings = structuredClone(SETTINGS_DEFAULTS_V14);
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

  it('registers mods.* and ownerChannel.* over the index, the app switch read from settings at each call', async () => {
    start();
    expect([...handlers.keys()].sort()).toEqual(['mods.list', 'mods.setSessionOverride', 'ownerChannel.answered', 'ownerChannel.cancel', 'ownerChannel.markRead', 'ownerChannel.state']);
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ id: 'maws.to-human', enabled: true, source: 'maws-contract' }]);
    settings = { ...settings, mods: { toHuman: { enabled: false } } };
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ enabled: false, source: 'off' }]);
    handlers.get('mods.setSessionOverride')!({ appSessionId: a, id: 'maws.to-human', value: 'on' });
    expect(await handlers.get('mods.list')!({ appSessionId: a })).toMatchObject([{ enabled: false, perSession: 'on', source: 'maws-contract', pending: 'next-launch' }]);
  });

  it('reads the user style from the engine’s config home', async () => {
    mkdirSync(join(root, 'engine-config', 'output-styles'), { recursive: true });
    writeFileSync(join(root, 'engine-config', 'output-styles', 'report.md'), '---\nname: report\nmaws-to-human-contract: 1\n---\n');
    writeFileSync(join(root, 'engine-config', 'settings.json'), JSON.stringify({ outputStyle: 'report' }));
    start();
    expect(await handlers.get('mods.list')!({})).toMatchObject([{ source: 'external-compatible-style' }]);
  });

  it('M4: feeds the host’s event batches to the marks, re-projects silently when the app switch or a session override moves, and stops listening', () => {
    index.ownerChannel.recordLaunch(a, { launchId: 'l1', at: '2026-10-09T09:00:00.000Z', laneOn: true, desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: 'maws-contract', style: 'default' });
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
      { appSessionId: a, kind: 'new', laneOn: true, override: 'inherit', desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: 'maws-contract', style: 'default', decidedBy: 'default', styleUnresolved: null },
      { launchId: 'l1', at: 't' },
    );
    expect(emitted.at(-1)).toMatchObject({ appSessionId: a, state: { lane: { on: true, applied: 'maws-contract', pending: null, mismatch: null } } });
    const init = { id: 'e1', sessionId: 's', at: 't', seq: 1, agentId: null, parentToolUseId: null, kind: 'session.init', outputStyle: 'Explanatory' } as unknown as SessionEvent;
    fire('session.eventBatch', { appSessionId: a, events: [init] });
    expect(index.ownerChannel.session(a)).toMatchObject({ style: 'default', observedStyle: 'Explanatory', styleMismatch: true });
    expect(emitted.at(-1)).toMatchObject({ appSessionId: a, state: { lane: { mismatch: { resolved: 'default', observed: 'Explanatory' } } } });
  });

  it('feeds the host’s queue snapshots to the answers: a queued answer edited in the queue reads as edited', () => {
    index.ownerChannel.recordLaunch(a, { launchId: 'l1', at: '2026-10-09T09:00:00.000Z', laneOn: true, desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: 'maws-contract', style: 'default' });
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

import { describe, expect, it } from 'vitest';
import { IpcErrorSchema } from './errors';
import { commandChannel, commands, eventChannel, events, NAMESPACES, type Namespace } from './schema';
import * as attention from './schema/attention';
import * as engine from './schema/engine';
import * as fs from './schema/fs';
import * as git from './schema/git';
import * as layout from './schema/layout';
import * as pty from './schema/pty';
import * as session from './schema/session';
import * as settings from './schema/settings';
import { isCommandName, isEventName, validateCommandInput, validateCommandOutput, validateEventPayload } from './validate';
// C3 start
import { C3_ATTENTION_COMMANDS, C3_ATTENTION_EVENTS } from './schema/attention';
import { C3_ENGINE_COMMANDS, C3_ENGINE_EVENTS } from './schema/engine';
import { C3_SESSION_COMMANDS, C3_SESSION_EVENTS } from './schema/session';
import { OPERATION_COMMANDS } from '../engine/operations';
// C3 end

// One entry per namespace, checked against NAMESPACES at compile time and at run time.
const modules = { session, engine, fs, git, pty, layout, attention, settings } satisfies Record<
  Namespace,
  { commands: object; events: object }
>;

describe('ipc schema validates both directions', () => {
  describe('registry composition', () => {
    it('has one module per namespace', () => {
      expect(Object.keys(modules).sort()).toEqual([...NAMESPACES].sort());
    });

    it.each(NAMESPACES)('keys of schema/%s.ts carry their namespace', (ns) => {
      for (const key of [...Object.keys(modules[ns].commands), ...Object.keys(modules[ns].events)]) {
        expect(key.startsWith(`${ns}.`), key).toBe(true);
      }
    });

    it('merges without losing a key to a duplicate', () => {
      const sum = (pick: 'commands' | 'events') =>
        Object.values(modules).reduce((n, m) => n + Object.keys(m[pick]).length, 0);
      expect(Object.keys(commands)).toHaveLength(sum('commands'));
      expect(Object.keys(events)).toHaveLength(sum('events'));
    });

    it('carries the C1 entries of Interfaces with their owners', () => {
      const owners = Object.fromEntries(Object.entries(commands).map(([name, spec]) => [name, spec.owner]));
      // C3: later children add entries, so C1's are pinned as a subset (they were the whole registry in C1)
      expect(owners).toMatchObject({
        'settings.get': 'main',
        'settings.set': 'main',
        'engine.ping': 'engine-host',
        'engine.hostState': 'main',
        'pty.hostState': 'main',
        'pty.ping': 'pty-host',
        'pty.spawn': 'pty-host',
        'pty.write': 'pty-host',
        'pty.resize': 'pty-host',
        'pty.kill': 'pty-host',
      });
      expect(Object.keys(events)).toEqual(
        expect.arrayContaining(['engine.hostState', 'pty.data', 'pty.exit', 'pty.hostState', 'settings.changed']),
      ); // C3: a subset, as above
    });

    it('carries the C4 fs.* entries, every command owned by the engine host', () => {
      expect(Object.keys(fs.commands).sort()).toEqual(['fs.bind', 'fs.holders', 'fs.scan', 'fs.state']);
      for (const spec of Object.values(fs.commands)) expect(spec.owner).toBe('engine-host');
      expect(Object.keys(fs.events).sort()).toEqual(['fs.holderChanged', 'fs.scanProgress', 'fs.sessionChanged', 'fs.sessionRemoved']);
    });

    it('names channels by kind so a command and an event of the same name never share one', () => {
      expect(commandChannel('engine.hostState')).toBe('maws:cmd:engine.hostState');
      expect(eventChannel('engine.hostState')).toBe('maws:evt:engine.hostState');
    });
  });

  describe('names', () => {
    it('knows registered names only, never prototype keys', () => {
      expect(isCommandName('settings.get')).toBe(true);
      expect(isCommandName('nope.thing')).toBe(false);
      expect(isCommandName('constructor')).toBe(false);
      expect(isCommandName(42)).toBe(false);
      expect(isEventName('pty.data')).toBe(true);
      expect(isEventName('settings.get')).toBe(false);
      expect(isEventName('toString')).toBe(false);
    });
  });

  describe('command input (main, on receipt)', () => {
    it('rejects settings.set({ theme: "sepia" }) as invalid_input with the issues', () => {
      const result = validateCommandInput('settings.set', { theme: 'sepia' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_input');
      expect(result.error.message).toContain('settings.set');
      expect(result.error.issues).toEqual([expect.objectContaining({ path: ['theme'] })]);
      expect(IpcErrorSchema.safeParse(result.error).success).toBe(true);
    });

    it('accepts each theme setting and an empty patch, and rejects the version or unknown keys', () => {
      for (const theme of ['light', 'dark', 'system']) {
        expect(validateCommandInput('settings.set', { theme })).toEqual({ ok: true, value: { theme } });
      }
      expect(validateCommandInput('settings.set', {})).toEqual({ ok: true, value: {} });
      expect(validateCommandInput('settings.set', { version: 1 }).ok).toBe(false);
      expect(validateCommandInput('settings.set', { theme: 'dark', accent: 'red' }).ok).toBe(false);
    });

    it('takes void input as undefined only', () => {
      expect(validateCommandInput('settings.get', undefined).ok).toBe(true);
      expect(validateCommandInput('engine.ping', {}).ok).toBe(false);
    });

    it('holds pty inputs to their shapes', () => {
      const spawn = { cwd: '/tmp', cols: 80, rows: 24 };
      expect(validateCommandInput('pty.spawn', spawn)).toEqual({ ok: true, value: spawn });
      expect(validateCommandInput('pty.spawn', { ...spawn, cols: 0 }).ok).toBe(false);
      expect(validateCommandInput('pty.spawn', { ...spawn, rows: 2.5 }).ok).toBe(false);
      expect(validateCommandInput('pty.spawn', { cols: 80, rows: 24 }).ok).toBe(false);
      expect(validateCommandInput('pty.write', { ptyId: 'p1', data: 'ls\n' }).ok).toBe(true);
      expect(validateCommandInput('pty.write', { ptyId: 'p1', data: 7 }).ok).toBe(false);
    });

    it('never transforms: an accepted input deep-equals what was sent', () => {
      const input = { shell: '/bin/sh', args: ['-l'], cwd: '/', cols: 1, rows: 1, env: { A: 'b' } };
      const result = validateCommandInput('pty.spawn', input);
      expect(result).toEqual({ ok: true, value: input });
    });
  });

  describe('command output (renderer, on receipt)', () => {
    const state = { settings: { version: 1, theme: 'system' }, resolvedTheme: 'dark' };

    it('accepts a settings state and returns it unchanged', () => {
      expect(validateCommandOutput('settings.get', state)).toEqual({ ok: true, value: state });
    });

    it('rejects a malformed output as invalid_output', () => {
      const result = validateCommandOutput('settings.get', { ...state, resolvedTheme: 'system' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_output');
      expect(result.error.issues).toEqual([expect.objectContaining({ path: ['resolvedTheme'] })]);
    });

    it('holds host snapshots to HostStateSchema, revision included', () => {
      const ready = { state: 'ready', pid: 4242, restarts: 0, revision: 3 };
      expect(validateCommandOutput('engine.hostState', ready).ok).toBe(true);
      expect(validateCommandOutput('pty.hostState', { ...ready, pid: null, state: 'crashed' }).ok).toBe(true);
      expect(validateCommandOutput('engine.hostState', { ...ready, revision: undefined }).ok).toBe(false);
      expect(validateCommandOutput('engine.hostState', { ...ready, state: 'sleeping' }).ok).toBe(false);
      expect(validateCommandOutput('engine.ping', { pid: 1, uptimeMs: 2.5, hostVersion: '0.0.0' }).ok).toBe(true);
    });
  });

  describe('event payload (main before sending, renderer on receipt)', () => {
    it('rejects a pty.data event whose data is a number', () => {
      const result = validateEventPayload('pty.data', { ptyId: 'p1', data: 42 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues).toEqual([expect.objectContaining({ path: ['data'] })]);
    });

    it('accepts well-formed events unchanged', () => {
      const exit = { ptyId: 'p1', exitCode: null, signal: null };
      expect(validateEventPayload('pty.exit', exit)).toEqual({ ok: true, value: exit });
      const changed = { settings: { version: 1, theme: 'light' }, resolvedTheme: 'light' };
      expect(validateEventPayload('settings.changed', changed)).toEqual({ ok: true, value: changed });
    });

    it('rejects unknown keys on the app’s own payloads', () => {
      expect(validateEventPayload('pty.data', { ptyId: 'p1', data: 'x', extra: true }).ok).toBe(false);
    });
  });

  // C3 start: the engine host's surface (C3 execution document, Interfaces "X2 — commands and events")
  describe('C3 entries', () => {
    const c3Commands = [...C3_SESSION_COMMANDS, ...C3_ENGINE_COMMANDS, ...C3_ATTENTION_COMMANDS];
    const status = {
      appSessionId: 'app-1', engineSessionId: null, pid: null, launchId: 'abcdefgh', launchedAt: '2026-09-28T10:00:00.000Z', taskListId: null, cwd: '/w', pendingPlan: null,
      process: 'starting', exit: null, engineState: 'unknown', activity: null, turn: null, model: { requested: null, resolved: null }, effort: null,
      permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
      gateway: { mode: 'gateway', baseUrl: null, verified: 'pending', autoModeServer: 'unknown', localLane: null },
      subagentModel: null, modelOverrides: {}, engineVersion: null, fileCheckpointing: true, fastMode: { state: null, disabledReason: null },
      plugins: [], pluginErrors: [], pluginWarnings: [], backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
      queue: { length: 0, paused: false }, keepAlive: [], memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '/j', hostHooks: [], lastEventSeq: 0,
    };

    it('registers every command and event of the X2 tables, owner engine-host but attention.* (owner main, ruling 1)', () => {
      for (const name of c3Commands) expect(Object.hasOwn(commands, name), name).toBe(true);
      for (const name of [...C3_SESSION_EVENTS, ...C3_ENGINE_EVENTS, ...C3_ATTENTION_EVENTS]) expect(Object.hasOwn(events, name), name).toBe(true);
      for (const name of c3Commands) expect(commands[name].owner, name).toBe(name.startsWith('attention.') ? 'main' : 'engine-host');
      expect(C3_SESSION_EVENTS).toEqual(['session.eventBatch', 'session.status', 'session.queue', 'session.brokerItems', 'session.operation', 'session.forgotten']);
      expect(C3_ATTENTION_COMMANDS).toEqual(['attention.list', 'attention.request']);
      expect(C3_ATTENTION_EVENTS).toEqual(['attention.changed']);
      expect(C3_ENGINE_COMMANDS).toEqual(['engine.binaryInfo', 'engine.relayHealth', 'engine.sessions', 'engine.shutdown']);
      for (const name of OPERATION_COMMANDS) expect(C3_SESSION_COMMANDS).toContain(name);
    });

    it('every session.* command input names the session appSessionId (session.launch through its spec)', () => {
      for (const name of C3_SESSION_COMMANDS) {
        const shape = (commands[name].input as unknown as { shape: Record<string, unknown> }).shape;
        if (name === 'session.launch') expect(Object.keys((shape.spec as { shape: object }).shape), name).toContain('appSessionId');
        else expect(Object.keys(shape), name).toContain('appSessionId');
      }
    });

    it("accepts C5's deny answer verbatim and refuses an allow without a scope", () => {
      const deny = { appSessionId: 'app-1', requestId: 'req-1', answer: { kind: 'permission', decision: 'deny' } };
      expect(validateCommandInput('session.answer', deny)).toEqual({ ok: true, value: deny });
      expect(validateCommandInput('session.answer', { ...deny, answer: { kind: 'permission', decision: 'allow' } }).ok).toBe(false);
      expect(validateCommandOutput('session.answer', { outcome: 'not_pending' }).ok).toBe(true);
    });

    it("session.steer takes an optional priority, now or next (coordinator ruling after M6 live 3.7)", () => {
      const steer = { appSessionId: 'app-1', content: 'Reply NEXT_OK' };
      expect(validateCommandInput('session.steer', steer)).toEqual({ ok: true, value: steer }); // absent: the host sends 'now'
      for (const priority of ['now', 'next'] as const) expect(validateCommandInput('session.steer', { ...steer, priority })).toEqual({ ok: true, value: { ...steer, priority } });
      expect(validateCommandInput('session.steer', { ...steer, priority: 'later' }).ok).toBe(false);
    });

    it('holds inputs strictly and never transforms', () => {
      const send = { appSessionId: 'app-1', content: 'hello' };
      expect(validateCommandInput('session.send', send)).toEqual({ ok: true, value: send });
      expect(validateCommandInput('session.send', { ...send, priority: 'now' }).ok).toBe(false);
      expect(validateCommandInput('session.send', { appSessionId: 'app-1', content: 'x'.repeat(1024 * 1024 + 1) }).ok).toBe(false);
      expect(validateCommandInput('session.events', { appSessionId: 'app-1', afterSeq: null, limit: null }).ok).toBe(true);
      expect(validateCommandInput('session.events', { appSessionId: 'app-1', afterSeq: 1.5, limit: null }).ok).toBe(false);
      expect(validateCommandInput('session.getContextUsage', { appSessionId: 'app-1', detail: 'summary' }).ok).toBe(true);
      expect(validateCommandInput('engine.shutdown', { graceMs: 5000 }).ok).toBe(true);
      expect(validateCommandInput('engine.sessions', undefined).ok).toBe(true);
      expect(validateCommandInput('session.stop', { appSessionId: 'app-1', reason: 'quit' }).ok).toBe(false);
      // `#` text is capped at 64 KiB so its synchronous commit is bounded by construction (M5 re-review)
      const note = (text: string) => validateCommandInput('session.memoryAppend', { appSessionId: 'app-1', text, target: { kind: 'project', path: null } });
      expect(note('x'.repeat(65_536)).ok).toBe(true);
      expect(note('x'.repeat(65_537))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    });

    it('types the launch answer as launching, relay_unreachable or refused with the five reasons', () => {
      expect(validateCommandOutput('session.launch', { status: 'launching', session: status }).ok).toBe(true);
      const health = { url: 'http://127.0.0.1:8641', ok: false, status: null, latencyMs: null, checkedAt: '2026-09-28T10:00:00.000Z', error: 'ECONNREFUSED' };
      expect(validateCommandOutput('session.launch', { status: 'relay_unreachable', health }).ok).toBe(true);
      for (const reason of ['already_live', 'binary_missing', 'binary_version', 'replay_disabled', 'settings_conflict']) {
        expect(validateCommandOutput('session.launch', { status: 'refused', reason, message: 'm' }).ok, reason).toBe(true);
      }
      expect(validateCommandOutput('session.launch', { status: 'refused', reason: 'busy', message: 'm' }).ok).toBe(false);
    });

    it('carries an operation receipt and its completion once, or once more late', () => {
      expect(validateCommandOutput('session.generateTitle', { opId: 'abcdefgh-7' }).ok).toBe(true);
      const done = { appSessionId: 'app-1', opId: 'abcdefgh-7', command: 'session.generateTitle', late: false, outcome: { ok: true, value: { title: 'Protocol probe' } } };
      expect(validateEventPayload('session.operation', done)).toEqual({ ok: true, value: done });
      const failed = { ...done, outcome: { ok: false, error: { code: 'timeout', message: 'generate_session_title unanswered after 120 s', engineCode: null } } };
      expect(validateEventPayload('session.operation', failed).ok).toBe(true);
      expect(validateEventPayload('session.operation', { ...done, command: 'session.getUsage' }).ok).toBe(false);
      expect(validateEventPayload('session.operation', { ...done, command: 'session.mcpToggle', outcome: { ok: true, value: null } }).ok).toBe(true);
    });

    it('validates the event payloads the host emits and main relays', () => {
      expect(validateEventPayload('session.status', { appSessionId: 'app-1', status }).ok).toBe(true);
      expect(validateEventPayload('session.eventBatch', { appSessionId: 'app-1', events: [] }).ok).toBe(true);
      expect(validateEventPayload('session.queue', { appSessionId: 'app-1', entries: [], paused: true }).ok).toBe(true);
      expect(validateEventPayload('session.brokerItems', { appSessionId: 'app-1', items: [] }).ok).toBe(true);
      expect(validateEventPayload('attention.changed', { appSessionId: 'app-1', items: [] }).ok).toBe(true);
      expect(validateCommandOutput('attention.request', { event: null }).ok).toBe(true);
      expect(validateCommandOutput('session.events', { events: [], lastSeq: 0, complete: true }).ok).toBe(true);
    });
  });
  // C3 end
});

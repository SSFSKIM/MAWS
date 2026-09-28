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
      expect(owners).toEqual({
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
      expect(Object.keys(events).sort()).toEqual(
        ['engine.hostState', 'pty.data', 'pty.exit', 'pty.hostState', 'settings.changed'].sort(),
      );
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
});

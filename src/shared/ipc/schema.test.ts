import { describe, expect, it } from 'vitest';
import { IpcErrorSchema } from './errors';
import { NAMES, MAIN_ONLY_COMMANDS } from './names';
import { commandChannel, commands, eventChannel, events, HOST_EVENTS, NAMESPACES, type Namespace } from './schema';
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
// C8c start
import * as files from './schema/files';
// C8c end
// E8 start
import * as plugins from './schema/plugins';
import * as marketplaces from './schema/marketplaces';
import { E8_SESSION_COMMANDS } from './schema/session';
// E8 end
// E1 start
import * as maws from './schema/maws';
// E1 end
// E3 start
import * as side from './schema/side';
// E3 end
// C11 start
import { SETTINGS_DEFAULTS_V13 } from '../settings/defaults';
// C11 end
// E9 start
import * as voice from './schema/voice';
// E9 end
// E6 start
import * as scm from './schema/scm';
// E6 end
// E2 start
import * as deliverables from './schema/deliverables';
// E2 end
// E10 start
import * as host from './schema/host';
// E10 end
// E4a start
import * as browser from './schema/browser';
// E4a end
// E4b start
import { DONE_REPORT, PROBE_EXTENSION } from '../../../test/support/import-reports';
// E4b end
// P2-C start (2026-10-09)
import * as mods from './schema/mods';
import * as ownerChannel from './schema/owner-channel'; // M4
// P2-C end
// P3-A start (M4)
import * as artifacts from './schema/artifacts';
import * as spaces from './schema/spaces';
import { artifactRefusalOf } from './schema/artifacts';
// P3-A end
import * as library from './schema/library'; // P3-L M1

// One entry per namespace, checked against NAMESPACES at compile time and at run time.
const modules = { session, engine, fs, git, pty, layout, attention, settings, files /* C8c */, plugins, marketplaces /* E8 */, voice /* E9 */, maws /* E1 */, scm /* E6 */, side /* E3 */, deliverables /* E2 */, host /* E10 */, browser /* E4a */, mods /* P2-C */, ownerChannel /* P2-C M4 */, artifacts, spaces /* P3-A M4 */, library /* P3-L M1 */ } satisfies Record<
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

    // Debt wave 4: the preload bridges these zod-free lists, not the registries.
    it.each(NAMESPACES)('names/%s.ts lists exactly schema/%s.ts’s keys, once each', (ns) => {
      expect([...NAMES[ns].commands]).toEqual(Object.keys(modules[ns].commands).filter((name) => !MAIN_ONLY_COMMANDS.includes(name as never)));
      expect([...NAMES[ns].events]).toEqual(Object.keys(modules[ns].events));
    });

    it('merges without losing a key to a duplicate', () => {
      const sum = (pick: 'commands' | 'events') =>
        Object.values(modules).reduce((n, m) => n + Object.keys(m[pick]).length, 0);
      expect(Object.keys(commands)).toHaveLength(sum('commands'));
      expect(Object.keys(events)).toHaveLength(sum('events'));
    });

    it('carries the C1 entries of Interfaces, and C9’s pty additions, with their owners', () => {
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
        // C9's additions (M2); `pty/*` is pinned in full by schema/pty.test.ts
        'pty.ack': 'pty-host',
        'pty.checkpoint': 'pty-host',
        'pty.attach': 'pty-host',
        'pty.list': 'pty-host',
        'pty.foreground': 'pty-host',
        'pty.openLink': 'main',
      });
      expect(Object.keys(events)).toEqual(
        expect.arrayContaining(['engine.hostState', 'pty.data', 'pty.exit', 'pty.hostState', 'settings.changed']),
      ); // C3: a subset, as above
    });

    it('carries the C4 fs.* entries, every command owned by the engine host', () => {
      expect(Object.keys(fs.commands).sort()).toEqual([
        'fs.agentEvents', 'fs.bind', 'fs.holders', 'fs.readSpill', 'fs.scan', 'fs.state', 'fs.subagents', 'fs.tasks', 'fs.unbind', 'fs.unfollow', 'fs.workflows',
      ]);
      for (const spec of Object.values(fs.commands)) expect(spec.owner).toBe('engine-host');
      expect(Object.keys(fs.events).sort()).toEqual([
        'fs.followState', 'fs.foreignWrite' /* W7 */, 'fs.holderChanged', 'fs.scanProgress', 'fs.sessionChanged', 'fs.sessionRemoved', 'fs.subagentsChanged', 'fs.tasksChanged', 'fs.workflowChanged',
      ]);
    });

    // C4 (M4): the record side of the index, owned by main.
    it('carries the C4 session.* record, project and draft entries, every command owned by main', () => {
      const c4 = ['session.drafts.get', 'session.drafts.set', 'session.get', 'session.list', 'session.projects.add', 'session.projects.list', 'session.projects.remove', 'session.projects.update', 'session.update'];
      for (const name of c4) expect(commands[name as keyof typeof commands]?.owner, name).toBe('main');
      for (const name of ['session.changed', 'session.removed', 'session.projects.changed']) expect(Object.hasOwn(events, name), name).toBe(true);
      expect(validateCommandInput('session.update', { appSessionId: 'a', patch: {} }).ok).toBe(false); // at least one field
      expect(validateCommandInput('session.update', { appSessionId: 'a', patch: { title: { text: 'x', source: 'generated' } } }).ok).toBe(false); // MAWS never sets generated
      expect(validateCommandInput('session.update', { appSessionId: 'a', patch: { title: null } }).ok).toBe(true);
    });

    // C4 (M5): replay, started in main and run in the engine host.
    it('carries the C4 session.replay.* entries with their owners and the speed and source bounds', () => {
      expect(commands['session.replay.start'].owner).toBe('main');
      expect(commands['session.replay.fixtures'].owner).toBe('main');
      expect(commands['session.replay.launch'].owner).toBe('engine-host');
      expect(commands['session.replay.control'].owner).toBe('engine-host');
      expect(Object.hasOwn(events, 'session.replay.progress')).toBe(true);
      const start = (source: unknown, speed: unknown) => validateCommandInput('session.replay.start', { source, speed }).ok;
      expect(start({ kind: 'journal', path: '/f/workflow.jsonl' }, 5)).toBe(true);
      expect(start({ kind: 'transcript', path: '/f/t.jsonl' }, 'instant')).toBe(true);
      expect(start({ kind: 'journal', path: '/f/workflow.jsonl' }, 0.25)).toBe(true);
      expect(start({ kind: 'journal', path: '/f/workflow.jsonl' }, 0.2)).toBe(false);
      expect(start({ kind: 'journal', path: '/f/workflow.jsonl' }, 51)).toBe(false);
      expect(start({ kind: 'journal', path: 'relative.jsonl' }, 1)).toBe(false);
      expect(start({ kind: 'wire', path: '/f/x.jsonl' }, 1)).toBe(false);
      expect(validateCommandInput('session.replay.control', { appSessionId: 'a', speed: 'instant' }).ok).toBe(true);
      expect(validateCommandInput('session.replay.control', { appSessionId: 'a', action: 'rewind' }).ok).toBe(false);
    });

    // C4 (M6): the read-only git service, owned by main.
    it('carries the C4 git.* entries, every command owned by main, with the diff and log bounds', () => {
      expect(Object.keys(git.commands).filter((name) => !name.startsWith('git.worktree.')) /* C10: its block is pinned below */.sort()).toEqual(['git.branches', 'git.diff', 'git.log', 'git.lsFiles' /* C7 */, 'git.status', 'git.unwatch', 'git.watch']);
      for (const spec of Object.values(git.commands)) expect(spec.owner).toBe('main');
      expect(Object.keys(git.events)).toEqual(['git.changed']);
      expect(validateCommandInput('git.diff', { directory: '/r', scope: 'all', base: 'main', path: 'a.ts', context: 20 }).ok).toBe(true);
      expect(validateCommandInput('git.diff', { directory: '/r', scope: 'everything' }).ok).toBe(false);
      expect(validateCommandInput('git.diff', { directory: '/r', scope: 'all', context: 21 }).ok).toBe(false);
      expect(validateCommandInput('git.log', { directory: '/r', limit: 0 }).ok).toBe(false);
      expect(validateCommandInput('git.log', { directory: '/r', limit: 500 }).ok).toBe(true);
    });
    // end C4

    // E6 start: git.diff's untracked scope (the service requires its path and refuses a base)
    it('accepts the E6 untracked scope on git.diff', () => {
      expect(validateCommandInput('git.diff', { directory: '/r', scope: 'untracked', path: 'new.txt' }).ok).toBe(true);
      expect(validateCommandInput('git.diff', { directory: '/r', scope: 'untracked', path: 'new.txt', context: 0 }).ok).toBe(true);
    });
    // E6 end

    // C10 start: the worktree service's git.worktree.* entries (C10 execution document, Interfaces "Worktrees"), owner main.
    it('carries the C10 git.worktree.* entries, every command owned by main, with the cleanup ladder’s refusals', () => {
      const c10 = Object.keys(git.commands).filter((name) => name.startsWith('git.worktree.'));
      expect(c10.sort()).toEqual(['git.worktree.add', 'git.worktree.branch', 'git.worktree.deleteBranch', 'git.worktree.list', 'git.worktree.remove', 'git.worktree.status']);
      for (const name of c10) expect(git.commands[name as keyof typeof git.commands].owner, name).toBe('main');
      const add = (branch: unknown) => validateCommandInput('git.worktree.add', { repoRoot: '/r', name: 'a', branch }).ok;
      expect(add({ kind: 'new', name: 'worktree-a', base: 'HEAD' })).toBe(true);
      expect(add({ kind: 'existing', name: 'b' })).toBe(true);
      expect(add({ kind: 'existing', name: 'b', base: 'HEAD' })).toBe(false);
      const remove = { repoRoot: '/r', path: '/r/.claude/worktrees/a', expect: { branch: null, head: 'abc' }, discard: false };
      expect(validateCommandInput('git.worktree.remove', remove).ok).toBe(true);
      expect(validateCommandInput('git.worktree.remove', { ...remove, expect: { head: 'abc' } }).ok).toBe(false);
      expect(validateCommandOutput('git.worktree.remove', { removed: true, prunedOnly: false }).ok).toBe(true);
      expect(validateCommandOutput('git.worktree.remove', { refused: 'changed', detail: 'head moved' }).ok).toBe(true);
      expect(validateCommandOutput('git.worktree.deleteBranch', { refused: 'unmerged', detail: '1 commit not on main' }).ok).toBe(true);
      expect(validateCommandOutput('git.worktree.deleteBranch', { deleted: true }).ok).toBe(false);
      expect(validateCommandOutput('git.worktree.status', null).ok).toBe(true);
    });
    // C10 end

    // C5 start: the shell's own entries (C5 execution document, Interfaces "X2"); the sibling entries it consumes are
    // pinned by C3's and C4's cases above.
    it('carries the C5 session.*, attention.* and layout.* entries, every command owned by main', () => {
      const c5 = ['session.digests', 'session.setVisible', 'session.launchMode', 'attention.pendingNavigate', 'layout.get', 'layout.set', 'layout.list', 'layout.openExternal', 'layout.setEnabledActions'];
      for (const name of c5) expect(commands[name as keyof typeof commands]?.owner, name).toBe('main');
      for (const name of ['session.digest', 'attention.notified', 'attention.navigate', 'layout.action']) expect(Object.hasOwn(events, name), name).toBe(true);
    });
    // C5 end

    // C8c start: the read-only files.* service over a session's own directories, owned by main.
    it('carries the C8c files.* entries, every command owned by main, with the read bounds', () => {
      expect(Object.keys(files.commands).sort()).toEqual(['files.list', 'files.openExternal', 'files.read', 'files.reveal' /* E1 */, 'files.unwatch', 'files.watch', 'files.write']);
      for (const spec of Object.values(files.commands)) expect(spec.owner).toBe('main');
      expect(Object.keys(files.events)).toEqual(['files.changed']);
      const read = (extra: object) => validateCommandInput('files.read', { appSessionId: 'a', path: '/r/a.ts', ...extra }).ok;
      expect(read({})).toBe(true);
      expect(read({ offset: 0, length: files.FILES_READ_MAX_LENGTH })).toBe(true);
      expect(read({ length: files.FILES_READ_MAX_LENGTH + 1 })).toBe(false);
      expect(read({ length: 0 })).toBe(false);
      expect(read({ offset: -1 })).toBe(false);
      expect(read({ offset: 1.5 })).toBe(false);
      expect(validateCommandInput('files.list', { appSessionId: 'a' }).ok).toBe(true);
      expect(validateCommandInput('files.list', { appSessionId: 'a', path: '/r', depth: 2 }).ok).toBe(false);
      expect(validateCommandInput('files.watch', { appSessionId: 'a' }).ok).toBe(false);
      const out = { encoding: 'utf8', content: 'x', bytes: 1, offset: 0, length: 1, truncated: false, mime: 'text/plain', hash: null, utf8: null };
      expect(validateCommandOutput('files.read', out)).toEqual({ ok: true, value: out });
      expect(validateCommandOutput('files.read', { ...out, encoding: 'latin1' }).ok).toBe(false);
      const entry = { name: 'a', path: '/r/a', kind: 'other', size: 0, mtimeMs: 1, target: null };
      expect(validateCommandOutput('files.list', { root: '/r', path: '/r', entries: [entry], truncated: false }).ok).toBe(true);
      expect(validateCommandOutput('files.openExternal', { opened: false, message: 'no app' }).ok).toBe(true);
      expect(validateEventPayload('files.changed', { appSessionId: 'a', path: '/r', kind: 'invalidated' }).ok).toBe(true);
      expect(validateEventPayload('files.changed', { appSessionId: 'a', path: '/r', kind: 'renamed' }).ok).toBe(false);
      // E1: Reveal in Finder answers like openExternal
      expect(validateCommandInput('files.reveal', { appSessionId: 'a', path: '/r/hello.txt' }).ok).toBe(true);
      expect(validateCommandOutput('files.reveal', { revealed: false, message: "path outside the session's directories" }).ok).toBe(true);
      expect(validateCommandOutput('files.reveal', { revealed: true }).ok).toBe(false);
    });
    // C8c end

    // E5 start: files.write, the hash-checked save, and the hash files.read answers on request.
    it('carries E5 files.write with the hash pattern and the content cap, and the read hash with its UTF-8 validity', () => {
      const hash = 'a'.repeat(64);
      expect(files.FILES_WRITE_MAX_BYTES).toBe(files.FILES_READ_MAX_LENGTH);
      expect(files.HashSchema.safeParse('0123456789abcdef'.repeat(4)).success).toBe(true);
      for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), ` ${'a'.repeat(63)}`]) {
        expect(files.HashSchema.safeParse(bad).success, bad).toBe(false);
      }

      const write = (extra: object) => validateCommandInput('files.write', { appSessionId: 'a', path: '/r/a.ts', content: 'x', expectedHash: hash, ...extra }).ok;
      expect(write({})).toBe(true);
      expect(write({ content: '' })).toBe(true);
      expect(write({ content: 'x'.repeat(files.FILES_WRITE_MAX_BYTES) })).toBe(true);
      expect(write({ content: 'x'.repeat(files.FILES_WRITE_MAX_BYTES + 1) })).toBe(false);
      expect(write({ expectedHash: 'A'.repeat(64) })).toBe(false);
      expect(write({ expectedHash: null })).toBe(false);
      expect(write({ create: true })).toBe(false);
      expect(validateCommandInput('files.write', { appSessionId: 'a', path: '/r/a.ts', content: 'x' }).ok).toBe(false);

      expect(validateCommandOutput('files.write', { status: 'ok', hash }).ok).toBe(true);
      expect(validateCommandOutput('files.write', { status: 'conflict', hash }).ok).toBe(true);
      expect(validateCommandOutput('files.write', { status: 'conflict', hash: null }).ok).toBe(false);
      expect(validateCommandOutput('files.write', { status: 'denied', hash }).ok).toBe(false);
      expect(validateCommandOutput('files.write', { status: 'ok', hash, path: '/r/a.ts' }).ok).toBe(false);

      const read = (extra: object) => validateCommandInput('files.read', { appSessionId: 'a', path: '/r/a.ts', ...extra }).ok;
      expect(read({ hash: true })).toBe(true);
      expect(read({ hash: 'yes' })).toBe(false);
      const out = { encoding: 'utf8', content: 'x', bytes: 1, offset: 0, length: 1, truncated: false, mime: 'text/plain' };
      expect(validateCommandOutput('files.read', { ...out, hash, utf8: true }).ok).toBe(true);
      expect(validateCommandOutput('files.read', { ...out, hash, utf8: false }).ok).toBe(true);
      expect(validateCommandOutput('files.read', { ...out, utf8: null }).ok).toBe(false); // the fields are always answered, null when not hashed
      expect(validateCommandOutput('files.read', { ...out, hash: null }).ok).toBe(false);
      expect(validateCommandOutput('files.read', { ...out, hash, utf8: 'yes' }).ok).toBe(false);
      expect(validateCommandOutput('files.read', { ...out, hash: 'A'.repeat(64), utf8: true }).ok).toBe(false);
    });
    // E5 end

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
      const spawn = { appSessionId: 'a1', label: 'terminal-1', cwd: '/tmp', cols: 80, rows: 24 };
      expect(validateCommandInput('pty.spawn', spawn)).toEqual({ ok: true, value: spawn });
      expect(validateCommandInput('pty.spawn', { ...spawn, cols: 0 }).ok).toBe(false);
      expect(validateCommandInput('pty.spawn', { ...spawn, rows: 2.5 }).ok).toBe(false);
      expect(validateCommandInput('pty.spawn', { appSessionId: 'a1', label: 'terminal-1', cols: 80, rows: 24 }).ok).toBe(false);
      expect(validateCommandInput('pty.write', { ptyId: 'p1', data: 'ls\n' }).ok).toBe(true);
      expect(validateCommandInput('pty.write', { ptyId: 'p1', data: 7 }).ok).toBe(false);
    });

    it('never transforms: an accepted input deep-equals what was sent', () => {
      const input = { appSessionId: 'a1', label: 'terminal-1', shell: '/bin/sh', args: ['-l'], cwd: '/', cols: 1, rows: 1, command: 'ls' };
      const result = validateCommandInput('pty.spawn', input);
      expect(result).toEqual({ ok: true, value: input });
    });
  });

  describe('command output (renderer, on receipt)', () => {
    const state = { settings: { ...SETTINGS_DEFAULTS_V13, theme: 'system' }, resolvedTheme: 'dark' };

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
      const result = validateEventPayload('pty.data', { ptyId: 'p1', offset: 0, data: 42 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues).toEqual([expect.objectContaining({ path: ['data'] })]);
    });

    it('accepts well-formed events unchanged', () => {
      const exit = { ptyId: 'p1', exitCode: null, signal: null };
      expect(validateEventPayload('pty.exit', exit)).toEqual({ ok: true, value: exit });
      const changed = { settings: { ...SETTINGS_DEFAULTS_V13, theme: 'light' }, resolvedTheme: 'light' };
      expect(validateEventPayload('settings.changed', changed)).toEqual({ ok: true, value: changed });
    });

    it('rejects unknown keys on the app’s own payloads', () => {
      expect(validateEventPayload('pty.data', { ptyId: 'p1', offset: 0, data: new Uint8Array(1), extra: true }).ok).toBe(false);
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
      subagentModel: null, modelOverrides: {}, engineVersion: null, fileCheckpointing: true, bin: '/b/claude', fastMode: { state: null, disabledReason: null },
      plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null /* P2-A */, backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
      queue: { length: 0, paused: false }, keepAlive: [], busy: false, lastUsedAt: '2026-09-28T10:00:00.000Z' /* C12 */, memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '/j', hostHooks: [], lastEventSeq: 0, trust: { attested: false, recorded: null } /* C10 */,
    };

    it('registers every command and event of the X2 tables, owner engine-host but attention.* (owner main, ruling 1)', () => {
      for (const name of c3Commands) expect(Object.hasOwn(commands, name), name).toBe(true);
      for (const name of [...C3_SESSION_EVENTS, ...C3_ENGINE_EVENTS, ...C3_ATTENTION_EVENTS]) expect(Object.hasOwn(events, name), name).toBe(true);
      for (const name of c3Commands) expect(commands[name].owner, name).toBe(name.startsWith('attention.') ? 'main' : 'engine-host');
      expect(C3_SESSION_EVENTS).toEqual(['session.eventBatch', 'session.status', 'session.queue', 'session.brokerItems', 'session.operation', 'session.forgotten']);
      expect(C3_ATTENTION_COMMANDS).toEqual(['attention.list', 'attention.request']);
      expect(C3_ATTENTION_EVENTS).toEqual(['attention.changed']);
      expect(C3_ENGINE_COMMANDS).toEqual(['engine.binaryInfo', 'engine.relayHealth', 'engine.sessions', 'engine.shutdown']);
      for (const name of OPERATION_COMMANDS) expect([...C3_SESSION_COMMANDS, ...E8_SESSION_COMMANDS] /* E8: session.reloadSkills */).toContain(name);
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

    it("session.queue.promote takes steer's optional priority, now or next (C7's composer)", () => {
      const promote = { appSessionId: 'app-1', queueId: 'q-1' };
      expect(validateCommandInput('session.queue.promote', promote)).toEqual({ ok: true, value: promote }); // absent: the host sends 'now'
      for (const priority of ['now', 'next'] as const) expect(validateCommandInput('session.queue.promote', { ...promote, priority })).toEqual({ ok: true, value: { ...promote, priority } });
      expect(validateCommandInput('session.queue.promote', { ...promote, priority: 'later' }).ok).toBe(false);
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

    it('types the launch answer as launching, relay_unreachable or refused with the four reasons', () => {
      expect(validateCommandOutput('session.launch', { status: 'launching', session: status }).ok).toBe(true);
      const health = { url: 'http://127.0.0.1:8641', ok: false, status: null, latencyMs: null, checkedAt: '2026-09-28T10:00:00.000Z', error: 'ECONNREFUSED' };
      expect(validateCommandOutput('session.launch', { status: 'relay_unreachable', health }).ok).toBe(true);
      for (const reason of ['already_live', 'binary_missing', 'replay_disabled', 'settings_conflict']) {
        expect(validateCommandOutput('session.launch', { status: 'refused', reason, message: 'm' }).ok, reason).toBe(true);
      }
      expect(validateCommandOutput('session.launch', { status: 'refused', reason: 'busy', message: 'm' }).ok).toBe(false);
      expect(validateCommandOutput('session.launch', { status: 'refused', reason: 'binary_version', message: 'm' }).ok).toBe(false); // W13: retired with the pin
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

  // C8a start: the panel summary's one layout key (C8a execution document, Interfaces *Layout key `summary.sections`*)
  describe('C8a entries', () => {
    it('takes summary.sections as a layout key, outside the panel namespace, and holds its value to its shape', () => {
      const value = { version: 1, collapsed: ['sources', 'push'] };
      expect(validateCommandInput('layout.get', { key: 'summary.sections' }).ok).toBe(true);
      expect(validateCommandInput('layout.set', { key: 'summary.sections', value })).toEqual({ ok: true, value: { key: 'summary.sections', value } });
      expect(validateCommandInput('layout.set', { key: 'summary.other', value }).ok).toBe(false);
      expect(layout.SummarySectionsSchema.safeParse(value).success).toBe(true);
      expect(layout.SummarySectionsSchema.safeParse({ version: 1, collapsed: [] }).success).toBe(true);
      expect(layout.SummarySectionsSchema.safeParse({ version: 1, collapsed: ['files'] }).success).toBe(false);
      expect(layout.SummarySectionsSchema.safeParse({ version: 2, collapsed: [] }).success).toBe(false);
      expect(layout.SummarySectionsSchema.safeParse({ ...value, open: [] }).success).toBe(false);
      expect(layout.SUMMARY_SECTIONS).toEqual(['environment', 'push', 'subagents', 'background', 'sources', 'plugins', 'deliverables']); // E2: deliverables appended
    });
  });
  // C8a end

  // C7 start: C7's additions (C7 execution document, Interfaces "X2 additions" and the Decision Log's execution-start entry)
  describe('C7 entries', () => {
    it("carries the queue's pause reason on session.queue and session.queue.list as a closed, nullable, optional set", () => {
      const queue = { appSessionId: 'app-1', entries: [], paused: true };
      expect(validateEventPayload('session.queue', queue).ok).toBe(true); // a state file older than the field
      for (const pauseReason of ['user', 'interrupt', 'write_failed', 'uncertain', 'exit', 'engine_turn', 'refused', 'store_failed', 'state_corrupt', null]) {
        expect(validateEventPayload('session.queue', { ...queue, pauseReason }).ok, String(pauseReason)).toBe(true);
        expect(validateCommandOutput('session.queue.list', { entries: [], paused: true, pauseReason }).ok, String(pauseReason)).toBe(true);
      }
      expect(validateEventPayload('session.queue', { ...queue, pauseReason: 'bored' }).ok).toBe(false);
      expect(validateCommandOutput('session.queue.list', { entries: [], paused: true, pauseReason: 'bored' }).ok).toBe(false);
    });

    it('registers the catalogue event, history, usage, file picking and file listing with their owners', () => {
      for (const name of ['session.history.list', 'session.history.append', 'settings.usage', 'layout.pickFiles', 'git.lsFiles'] as const) expect(commands[name].owner, name).toBe('main');
      for (const name of ['session.catalogChanged', 'settings.usageChanged']) expect(Object.hasOwn(events, name), name).toBe(true);
    });

    it('session.catalogChanged carries the whole catalogue under its launch', () => {
      const catalog = { commands: [{ name: 'compact', description: 'Compact', argumentHint: '', builtin: true }], agents: [], skills: ['dataviz'], terminalSlashCommands: ['doctor'], revision: 2 };
      const changed = { appSessionId: 'app-1', launchId: 'abcdefgh', catalog };
      expect(validateEventPayload('session.catalogChanged', changed)).toEqual({ ok: true, value: changed });
      expect(validateEventPayload('session.catalogChanged', { appSessionId: 'app-1', catalog }).ok).toBe(false);
      expect(validateEventPayload('session.catalogChanged', { ...changed, catalog: { ...catalog, revision: 1.5 } }).ok).toBe(false);
    });

    it("session.history.* carry the terminal's record shapes, bounded", () => {
      const text = { id: 1, type: 'text', content: 'body', contentHash: null, mediaType: null, filename: null };
      const image = { id: 2, type: 'image', content: null, contentHash: null, mediaType: 'image/png', filename: 'shot.png' };
      expect(validateCommandInput('session.history.list', { appSessionId: 'app-1', limit: 200 }).ok).toBe(true);
      expect(validateCommandInput('session.history.list', { appSessionId: 'app-1', limit: 501 }).ok).toBe(false);
      expect(validateCommandInput('session.history.list', { appSessionId: 'app-1', limit: 0 }).ok).toBe(false);
      const append = { appSessionId: 'app-1', display: 'see [Pasted text #1 +40 lines]', pastedContents: { '1': text, '2': image } };
      expect(validateCommandInput('session.history.append', append)).toEqual({ ok: true, value: append });
      expect(validateCommandInput('session.history.append', { ...append, display: '' }).ok).toBe(false);
      expect(validateCommandInput('session.history.append', { ...append, display: 'x'.repeat(65_536) }).ok).toBe(true); // a long prompt as typed
      expect(validateCommandInput('session.history.append', { ...append, display: 'x'.repeat(65_537) }).ok).toBe(false);
      expect(validateCommandInput('session.history.append', { ...append, pastedContents: { '1': { ...text, type: 'file' } } }).ok).toBe(false);
      // an unstarted session's append names the intended project (M4); main uses it only when the session has no record
      expect(validateCommandInput('session.history.append', { ...append, project: '/repo' }).ok).toBe(true);
      expect(validateCommandInput('session.history.append', { ...append, project: null }).ok).toBe(true);
      expect(validateCommandInput('session.history.append', { ...append, project: 7 }).ok).toBe(false);
      const entry = { display: 'hello', at: '2026-09-28T10:00:00.000Z', source: 'terminal', sessionId: null, pastedContents: { '1': { ...text, content: null, contentHash: 'c5ddbb6e32f0ffa0' } } };
      expect(validateCommandOutput('session.history.list', { entries: [entry] }).ok).toBe(true);
      expect(validateCommandOutput('session.history.list', { entries: [{ ...entry, source: 'cloud' }] }).ok).toBe(false);
      expect(validateCommandOutput('session.history.append', undefined).ok).toBe(true);
    });

    it('settings.usage answers the snapshot, pins for the ids asked, bounded at 64', () => {
      const window = { percent: 51, resetsAt: '2026-09-28T16:09:59Z', recordedAt: '2026-09-28T15:10:29Z' };
      const account = {
        uuid: 'a1', email: '1@example.test', displayName: 'Account 1', planLabel: 'Max', rateLimitTier: null, needsReauthentication: false, lastSeenActive: null,
        pinnedSessionCount: 3, credentialOwnership: 'appManaged', windows: { fiveHour: window, sevenDay: null, scoped: [{ model: 'Fable', window }] },
      };
      const snapshot = { available: true, dataDir: '/d', readAt: '2026-09-28T15:11:00.000Z', error: null, drainTarget: 'a1', drainTargetIsManual: false, accounts: [account], pinsFor: { s1: 'a1' }, gateway: null, codex: null, activity: null };
      expect(validateCommandInput('settings.usage', { engineSessionIds: [] }).ok).toBe(true);
      expect(validateCommandInput('settings.usage', { engineSessionIds: Array.from({ length: 65 }, (_, i) => `s${i}`) }).ok).toBe(false);
      expect(validateCommandOutput('settings.usage', snapshot)).toEqual({ ok: true, value: snapshot });
      expect(validateEventPayload('settings.usageChanged', snapshot).ok).toBe(true);
      expect(validateCommandOutput('settings.usage', { ...snapshot, accounts: [{ ...account, credentialOwnership: 'borrowed' }] }).ok).toBe(false);
      expect(validateCommandOutput('settings.usage', { ...snapshot, accounts: [{ ...account, pinnedSessionCount: -1 }] }).ok).toBe(false);
    });

    it('layout.pickFiles and the file listing hold their bounds', () => {
      expect(validateCommandInput('layout.pickFiles', { kind: 'photos', directory: null, multiple: true }).ok).toBe(true);
      expect(validateCommandInput('layout.pickFiles', { kind: 'folders', directory: null, multiple: true }).ok).toBe(false);
      const picked = { path: '/r/a.png', name: 'a.png', bytes: 3, mediaType: 'image/png', data: 'AAAA' };
      expect(validateCommandOutput('layout.pickFiles', { files: [picked, { ...picked, path: '/r', name: 'r', bytes: 0, mediaType: 'inode/directory', data: null }] }).ok).toBe(true);
      expect(validateCommandInput('git.lsFiles', { directory: '/r', query: 'main', limit: 30 }).ok).toBe(true);
      expect(validateCommandInput('git.lsFiles', { directory: '/r', query: 'x'.repeat(257), limit: 30 }).ok).toBe(false);
      expect(validateCommandInput('git.lsFiles', { directory: '/r', query: '', limit: 201 }).ok).toBe(false);
      expect(validateCommandOutput('git.lsFiles', { paths: ['src/main.ts'], truncated: false, source: 'walk' }).ok).toBe(true);
      expect(validateCommandOutput('git.lsFiles', { paths: [], truncated: false, source: 'fs' }).ok).toBe(false);
    });
  });
  // C7 end
  // C10 start: the attach tabs' layout key (C10 execution document, M5)
  describe('C10 layout entries', () => {
    it('takes sessions.attachTabs as a layout key, outside the panel namespace, and holds its value to its shape', () => {
      const value = { version: 1, tabs: [{ tabId: 'terminal:abc', appSessionId: 'a1111111-1111-4111-8111-111111111111', jobId: 'e6dcd828' }] };
      expect(validateCommandInput('layout.set', { key: 'sessions.attachTabs', value })).toEqual({ ok: true, value: { key: 'sessions.attachTabs', value } });
      expect(layout.AttachTabsSchema.safeParse(value).success).toBe(true);
      expect(layout.AttachTabsSchema.safeParse({ version: 1, tabs: [{ ...value.tabs[0], command: 'x' }] }).success).toBe(false);
      expect(layout.AttachTabsSchema.safeParse({ version: 2, tabs: [] }).success).toBe(false);
    });
  });
  // C10 end
  // C11 start
  describe('C11 entries', () => {
    it('adds its six commands under existing namespaces with their owners, and no namespace or event', () => {
      const owners = { 'settings.claudeUsage.status': 'main', 'settings.claudeUsage.open': 'main', 'settings.reveal': 'main', 'layout.saveTextFile': 'main', 'layout.captureChords': 'main', 'engine.configure': 'engine-host' } as const;
      // Every C11 command sits under a namespace that existed before C11 (C8c's `files`, E8's `plugins` and
      // `marketplaces`, E9's `voice`, E1's `maws`, E6's `scm`, E3's `side`, E2's `deliverables`, E10's `host` and E4a's
      // `browser` are the ones added since).
      const before = ['session', 'engine', 'fs', 'git', 'pty', 'layout', 'attention', 'settings'];
      for (const name of Object.keys(owners)) expect(before, name).toContain(name.split('.')[0]);
      expect(NAMESPACES.filter((ns) => !before.includes(ns))).toEqual(['files', 'plugins', 'marketplaces', 'voice', 'maws', 'scm', 'side', 'deliverables', 'host', 'browser', 'mods' /* P2-C */, 'ownerChannel' /* P2-C M4 */, 'artifacts', 'spaces' /* P3-A M4 */, 'library' /* P3-L M1 */]);
      for (const [name, owner] of Object.entries(owners)) expect(commands[name as keyof typeof owners].owner, name).toBe(owner);
      for (const name of Object.keys(owners)) expect(Object.hasOwn(events, name), name).toBe(false);
    });

    it('settings.get and settings.changed carry the whole version 3 state', () => {
      const state = { settings: { ...SETTINGS_DEFAULTS_V13, gateway: { defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false } }, resolvedTheme: 'light' };
      expect(validateCommandOutput('settings.get', state)).toEqual({ ok: true, value: state });
      expect(validateEventPayload('settings.changed', state).ok).toBe(true);
      expect(validateEventPayload('settings.changed', { ...state, settings: { ...state.settings, version: 2 } }).ok).toBe(false);
    });

    it('settings.set takes a section by field and one notification kind alone', () => {
      expect(validateCommandInput('settings.set', { notifications: { kinds: { errors: false } } }).ok).toBe(true);
      expect(validateCommandInput('settings.set', { gateway: { relayUnreachable: 'wait' } }).ok).toBe(true);
      expect(validateCommandInput('settings.set', { engine: { binaryPath: null } }).ok).toBe(true);
      expect(validateCommandInput('settings.set', { engine: { binaryPath: 'bin/claude' } }).ok).toBe(false);
      expect(validateCommandInput('settings.set', { usage: { nearLimitPercent: 95 } }).ok).toBe(true);
      expect(validateCommandInput('settings.set', { usage: { nearLimitPercent: 40 } }).ok).toBe(false);
      expect(validateCommandInput('settings.set', { appearance: { monoFont: 'Hack Nerd Font' } }).ok).toBe(true);
      expect(validateCommandInput('settings.set', { gateway: { relay: 'x' } }).ok).toBe(false);
    });

    it('settings.claudeUsage.open takes the four intents, an email only in the two that name an account', () => {
      const ok = (input: unknown) => validateCommandInput('settings.claudeUsage.open', input).ok;
      expect(ok({ intent: 'panel' })).toBe(true);
      expect(ok({ intent: 'addAccount' })).toBe(true);
      expect(ok({ intent: 'reconnect', accountEmail: '1@example.test' })).toBe(true);
      expect(ok({ intent: 'remove', accountEmail: '1@example.test' })).toBe(true);
      expect(ok({ intent: 'panel', accountEmail: null })).toBe(false);
      expect(ok({ intent: 'reconnect' })).toBe(false);
      expect(ok({ intent: 'remove', accountEmail: '' })).toBe(false);
      expect(ok({ intent: 'login' })).toBe(false);
      const out = (value: unknown) => validateCommandOutput('settings.claudeUsage.open', value).ok;
      expect(out({ opened: true, reason: null, instruction: 'ClaudeUsage is in the menu bar · click its icon' })).toBe(true);
      expect(out({ opened: false, reason: 'not_installed', instruction: 'x' })).toBe(true);
      expect(out({ opened: false, reason: 'crashed', instruction: 'x' })).toBe(false);
    });

    it('settings.claudeUsage.status answers the bundle id it checked', () => {
      const status = { installed: true, running: false, bundleId: 'com.haegi.ClaudeUsage', dataDirPresent: true, checkedAt: '2026-09-29T08:00:00.000Z' };
      expect(validateCommandInput('settings.claudeUsage.status', undefined).ok).toBe(true);
      expect(validateCommandOutput('settings.claudeUsage.status', status)).toEqual({ ok: true, value: status });
      expect(validateCommandOutput('settings.claudeUsage.status', { ...status, bundleId: 'com.example.Other' }).ok).toBe(false);
    });

    it('settings.reveal takes a path and answers whether it revealed', () => {
      expect(validateCommandInput('settings.reveal', { path: '/Users/new/.claude/settings.json' }).ok).toBe(true);
      expect(validateCommandInput('settings.reveal', { path: 1 }).ok).toBe(false);
      expect(validateCommandOutput('settings.reveal', { revealed: false }).ok).toBe(true);
    });

    it('engine.configure takes an absolute path or null and answers binaryInfo', () => {
      expect(validateCommandInput('engine.configure', { binaryPath: null }).ok).toBe(true);
      expect(validateCommandInput('engine.configure', { binaryPath: '/opt/claude' }).ok).toBe(true);
      expect(validateCommandInput('engine.configure', { binaryPath: 'claude' }).ok).toBe(false);
      expect(validateCommandInput('engine.configure', { binaryPath: '/opt/claude', expectedVersion: '2.1.283' }).ok).toBe(false); // W13: no expected version
      const info = { path: '/opt/claude', testedVersion: '2.1.283', version: null, ok: false, error: 'no executable engine binary at /opt/claude' };
      expect(validateCommandOutput('engine.configure', info)).toEqual({ ok: true, value: info });
    });

    it('layout.saveTextFile takes a bounded name and text and answers saved with a path, or not saved', () => {
      expect(validateCommandInput('layout.saveTextFile', { defaultName: 'a.txt', text: '' }).ok).toBe(true);
      expect(validateCommandInput('layout.saveTextFile', { defaultName: '', text: 'x' }).ok).toBe(false);
      expect(validateCommandInput('layout.saveTextFile', { defaultName: 'x'.repeat(256), text: 'x' }).ok).toBe(false);
      expect(validateCommandOutput('layout.saveTextFile', { saved: true, path: '/Users/new/Downloads/a.txt' }).ok).toBe(true);
      expect(validateCommandOutput('layout.saveTextFile', { saved: false }).ok).toBe(true);
      expect(validateCommandOutput('layout.saveTextFile', { saved: true }).ok).toBe(false);
      expect(validateCommandOutput('layout.saveTextFile', { saved: false, path: '/x' }).ok).toBe(false);
    });

    it('layout.captureChords takes exactly { active } and answers nothing (M5 fix wave)', () => {
      expect(validateCommandInput('layout.captureChords', { active: true }).ok).toBe(true);
      expect(validateCommandInput('layout.captureChords', { active: false }).ok).toBe(true);
      expect(validateCommandInput('layout.captureChords', {}).ok).toBe(false);
      expect(validateCommandInput('layout.captureChords', { active: 'yes' }).ok).toBe(false);
      expect(validateCommandInput('layout.captureChords', { active: true, extra: 1 }).ok).toBe(false);
      expect(validateCommandOutput('layout.captureChords', undefined).ok).toBe(true);
    });
  });
  // C11 end
  // C12 start: the memory budget (C12 execution document, Interfaces "X2 additions")
  describe('C12 entries', () => {
    const state = {
      enabled: true, limitKiB: 8_388_608, totalKiB: 9_000_000, sampledAt: '2026-09-29T10:00:00.000Z', over: true, overWithoutCandidate: false, candidates: 1, settling: 0,
      releasing: 'app-1', blocked: [{ appSessionId: 'app-2', reasons: ['turn', 'stateful_mcp'] }], lastRelease: { appSessionId: 'app-3', at: '2026-09-29T09:59:50.000Z', totalKiB: 9_100_000 },
    };

    it('engine.policy.set and engine.budget are engine-host commands; engine.budget is also an event, and only the budget read is bridged', () => {
      for (const name of ['engine.policy.set', 'engine.budget'] as const) expect(commands[name].owner, name).toBe('engine-host');
      expect(Object.hasOwn(events, 'engine.budget')).toBe(true);
      expect(NAMES.engine.commands).toContain('engine.budget');
      expect(NAMES.engine.commands).not.toContain('engine.policy.set');
      expect(NAMES.engine.events).toContain('engine.budget');
    });

    it('engine.policy.set takes a positive whole budget in KiB and at most 64 stateful server names, and answers the budget state', () => {
      expect(validateCommandInput('engine.policy.set', { enabled: true, limitKiB: 8_388_608, statefulMcpServers: ['plugin:ptc:ptc'] }).ok).toBe(true);
      expect(validateCommandInput('engine.policy.set', { enabled: true, limitKiB: 0, statefulMcpServers: [] }).ok).toBe(false);
      expect(validateCommandInput('engine.policy.set', { enabled: true, limitKiB: 1.5, statefulMcpServers: [] }).ok).toBe(false);
      expect(validateCommandInput('engine.policy.set', { enabled: true, limitKiB: 1, statefulMcpServers: Array.from({ length: 65 }, (_, i) => `s${i}`) }).ok).toBe(false);
      expect(validateCommandInput('engine.policy.set', { enabled: true, limitKiB: 1, statefulMcpServers: [], extra: 1 }).ok).toBe(false);
      expect(validateCommandInput('engine.policy.set', { enabled: false, limitKiB: 8_388_608, statefulMcpServers: [] }).ok).toBe(true); // W7: off, the limit kept
      expect(validateCommandInput('engine.policy.set', { limitKiB: 8_388_608, statefulMcpServers: [] }).ok).toBe(false); // W7: the switch is always said
      expect(validateCommandOutput('engine.policy.set', state)).toEqual({ ok: true, value: state });
    });

    it('the budget state names hard reasons from the closed set and nothing else', () => {
      expect(validateCommandInput('engine.budget', undefined).ok).toBe(true);
      expect(validateEventPayload('engine.budget', state).ok).toBe(true);
      expect(validateEventPayload('engine.budget', { ...state, releasing: null, lastRelease: null, sampledAt: null }).ok).toBe(true);
      expect(validateEventPayload('engine.budget', { ...state, blocked: [{ appSessionId: 'app-2', reasons: ['grants'] }] }).ok).toBe(false);
      expect(validateEventPayload('engine.budget', { ...state, unmeasured: 0 }).ok).toBe(false);
    });
  });
  // C12 end
  // E9 start: push-to-talk dictation (E9 execution document, Interfaces "X2 `voice.*`")
  describe('E9 entries', () => {
    const captureId = '3f2b8c1e-6d4a-4f7b-9a1e-2c5d8e7f6a90';
    const permission = { microphone: 'authorized', speech: 'notDetermined' };
    const status = { helper: { state: 'ready', path: '/x/maws-voice-helper' }, backend: 'helper', permission, systemLocale: 'ko-KR', locale: 'en-US', supportsOnDevice: true, locales: ['en-US', 'ko-KR'] };

    it('adds the voice namespace: five commands owned by main, one event, every name bridged', () => {
      expect(Object.keys(voice.commands)).toEqual(['voice.status', 'voice.start', 'voice.stop', 'voice.cancel', 'voice.openPrivacySettings']);
      for (const spec of Object.values(voice.commands)) expect(spec.owner).toBe('main');
      expect(Object.keys(voice.events)).toEqual(['voice.event']);
      expect([...NAMES.voice.commands]).toEqual(Object.keys(voice.commands));
    });

    it('voice.status takes a bounded locale or null and answers the helper, the permissions and the locales', () => {
      expect(validateCommandInput('voice.status', { locale: null }).ok).toBe(true);
      expect(validateCommandInput('voice.status', { locale: 'en-US' }).ok).toBe(true);
      expect(validateCommandInput('voice.status', { locale: 'e' }).ok).toBe(false);
      expect(validateCommandInput('voice.status', {}).ok).toBe(false);
      expect(validateCommandOutput('voice.status', status)).toEqual({ ok: true, value: status });
      const unprobed = { ...status, helper: { state: 'missing', path: '/x' }, permission: null, systemLocale: null, supportsOnDevice: null, locales: [] };
      expect(validateCommandOutput('voice.status', unprobed).ok).toBe(true);
      expect(validateCommandOutput('voice.status', { ...status, helper: { state: 'failed', path: '/x', message: 'no ready line' } }).ok).toBe(true);
      expect(validateCommandOutput('voice.status', { ...status, helper: { state: 'failed', path: '/x' } }).ok).toBe(false); // a failure says why
      expect(validateCommandOutput('voice.status', { ...status, backend: 'helper-probe-only' }).ok).toBe(false);
      expect(validateCommandOutput('voice.status', { ...status, permission: { ...permission, speech: 'granted' } }).ok).toBe(false);
    });

    it('voice.start takes a UUID capture id and answers accepted, or refused with a reason and a path', () => {
      expect(validateCommandInput('voice.start', { captureId, locale: null }).ok).toBe(true);
      expect(validateCommandInput('voice.start', { captureId: 'capture-1', locale: null }).ok).toBe(false);
      expect(validateCommandInput('voice.start', { captureId, locale: 'x'.repeat(33) }).ok).toBe(false);
      expect(validateCommandOutput('voice.start', { accepted: true }).ok).toBe(true);
      expect(validateCommandOutput('voice.start', { accepted: true, reason: 'busy' }).ok).toBe(false);
      for (const reason of ['busy', 'helper_missing', 'helper_failed', 'e2e_refused', 'cancelled']) {
        expect(validateCommandOutput('voice.start', { accepted: false, reason, path: null }).ok, reason).toBe(true);
      }
      expect(validateCommandOutput('voice.start', { accepted: false, reason: 'denied', path: null }).ok).toBe(false);
      expect(validateCommandOutput('voice.start', { accepted: false, reason: 'busy' }).ok).toBe(false);
    });

    it('voice.stop, voice.cancel and voice.openPrivacySettings take exactly their fields and answer nothing', () => {
      for (const name of ['voice.stop', 'voice.cancel'] as const) {
        expect(validateCommandInput(name, { captureId }).ok).toBe(true);
        expect(validateCommandInput(name, { captureId, reason: 'keyup' }).ok).toBe(false);
      }
      expect(validateCommandInput('voice.openPrivacySettings', { pane: 'microphone' }).ok).toBe(true);
      expect(validateCommandInput('voice.openPrivacySettings', { pane: 'speech' }).ok).toBe(true);
      expect(validateCommandInput('voice.openPrivacySettings', { pane: 'camera' }).ok).toBe(false);
      expect(validateCommandOutput('voice.openPrivacySettings', undefined).ok).toBe(true);
    });

    it('voice.event carries each kind with its capture id and refuses an unknown kind, code or key', () => {
      const valid = [
        { kind: 'permission', captureId, permission },
        { kind: 'started', captureId, locale: 'en-US' },
        { kind: 'partial', captureId, text: 'hello' },
        { kind: 'final', captureId, text: 'Hello.', timedOut: false },
        { kind: 'cancelled', captureId },
        { kind: 'error', captureId, code: 'helper_crashed', message: 'the helper exited' },
      ];
      for (const event of valid) expect(validateEventPayload('voice.event', event)).toEqual({ ok: true, value: event });
      expect(validateEventPayload('voice.event', { kind: 'ready', captureId }).ok).toBe(false);
      expect(validateEventPayload('voice.event', { kind: 'error', captureId, code: 'teapot', message: '' }).ok).toBe(false);
      expect(validateEventPayload('voice.event', { kind: 'final', captureId, text: 'x' }).ok).toBe(false);
      expect(validateEventPayload('voice.event', { kind: 'partial', captureId, text: 'x', id: captureId }).ok).toBe(false);
    });
  });
  // E9 end
  // E8 start: plugin management through the engine's CLI (E8 execution document, Interfaces "X2")
  describe('E8 entries', () => {
    const cwd = '/r';
    it('adds plugins.* and marketplaces.*, every command owned by the engine host, and session.reloadSkills as an operation', () => {
      expect(Object.keys(plugins.commands)).toEqual(['plugins.env', 'plugins.list', 'plugins.available', 'plugins.install', 'plugins.update', 'plugins.uninstall', 'plugins.enable', 'plugins.disable', 'plugins.cancel', 'plugins.manifest' /* P2-B */]);
      expect(Object.keys(plugins.events)).toEqual(['plugins.operation', 'plugins.changed']);
      expect(Object.keys(marketplaces.commands)).toEqual(['marketplaces.list', 'marketplaces.add', 'marketplaces.update', 'marketplaces.remove']);
      expect(Object.keys(marketplaces.events)).toEqual([]);
      for (const spec of [...Object.values(plugins.commands), ...Object.values(marketplaces.commands)]) expect(spec.owner).toBe('engine-host');
      expect(E8_SESSION_COMMANDS).toEqual(['session.reloadSkills']);
      expect(commands['session.reloadSkills'].owner).toBe('engine-host');
      expect(OPERATION_COMMANDS).toContain('session.reloadSkills');
      expect(validateCommandOutput('session.reloadSkills', { opId: 'r-1' }).ok).toBe(true);
    });

    it('takes an absolute cwd, the binary the sheet named, a scope from the three, a sha256 to accept, and no value the CLI would read as an option', () => {
      const binary = '/opt/claude/2.1.291';
      expect(validateCommandInput('plugins.install', { cwd, plugin: 'p@m' }).ok).toBe(false); // a mutation names the binary its sheet showed
      expect(validateCommandInput('marketplaces.remove', { cwd, binary: 'claude', name: 'm' }).ok).toBe(false);
      expect(validateCommandInput('plugins.install', { cwd, binary, plugin: 'p@m' }).ok).toBe(true);
      expect(validateCommandInput('plugins.install', { cwd, binary, plugin: 'p@m', scope: 'project', acceptCommand: 'a'.repeat(64) }).ok).toBe(true);
      expect(validateCommandInput('plugins.install', { cwd, binary, plugin: 'p@m', acceptCommand: 'A'.repeat(64) }).ok).toBe(false);
      expect(validateCommandInput('plugins.install', { cwd, binary, plugin: 'p@m', scope: 'managed' }).ok).toBe(false);
      expect(validateCommandInput('plugins.install', { cwd, binary, plugin: '-y' }).ok).toBe(false);
      expect(validateCommandInput('plugins.install', { cwd: 'relative', binary, plugin: 'p@m' }).ok).toBe(false);
      expect(validateCommandInput('plugins.uninstall', { cwd, binary, plugin: 'p@m', keepData: true }).ok).toBe(true);
      expect(validateCommandInput('plugins.enable', { cwd, binary, plugin: 'p@m', acceptCommand: 'a'.repeat(64) }).ok).toBe(false);
      expect(validateCommandInput('marketplaces.add', { cwd, binary, source: 'owner/repo', scope: 'user' }).ok).toBe(true);
      expect(validateCommandInput('marketplaces.add', { cwd, binary, source: '--yes' }).ok).toBe(false);
      expect(validateCommandInput('marketplaces.update', { cwd, binary, name: 'm', scope: 'user' }).ok).toBe(false); // update takes no scope
      expect(validateCommandInput('marketplaces.remove', { cwd, binary, name: 'm', scope: 'local' }).ok).toBe(true);
      expect(validateCommandInput('plugins.env', {}).ok).toBe(true);
      expect(validateCommandOutput('plugins.cancel', { cancelled: true }).ok).toBe(true);
    });

    it('carries an operation’s phases, its outcome and its reload per session', () => {
      const base = { opId: 'o', action: 'install', target: 'p@m' };
      expect(validateEventPayload('plugins.operation', { ...base, phase: 'started' }).ok).toBe(true);
      expect(validateEventPayload('plugins.operation', { ...base, phase: 'output', line: 'Cloning…' }).ok).toBe(true);
      expect(validateEventPayload('plugins.operation', { ...base, phase: 'done', outcome: { ok: true, result: { command: 'install', outcome: 'ok' } }, reload: { sessions: [{ appSessionId: 'a', outcome: 'reflected', error: null }] } }).ok).toBe(true);
      const failure = { ok: false, error: { code: 'cli_failed', message: 'Plugin "nope" not found', failureCode: 'not_found', shownCommand: null } };
      expect(validateEventPayload('plugins.operation', { ...base, phase: 'done', outcome: failure }).ok).toBe(true);
      expect(validateEventPayload('plugins.operation', { ...base, phase: 'done', outcome: { ...failure, error: { ...failure.error, code: 'output_overflow', failureCode: null } } }).ok).toBe(true);
      expect(validateEventPayload('plugins.operation', { ...base, phase: 'done', outcome: { ...failure, error: { ...failure.error, code: 'refused' } } }).ok).toBe(false);
      expect(validateEventPayload('plugins.operation', { ...base, action: 'marketplace-sync', phase: 'started' }).ok).toBe(false);
      expect(validateEventPayload('plugins.changed', {}).ok).toBe(true);
      const row = { id: 'p@m', name: 'p', marketplace: 'm', version: '0.1.0', scope: 'user', enabled: true, projectPath: null, installPath: '/c', errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false /* P2-B */ };
      expect(validateCommandOutput('plugins.list', { plugins: [row] }).ok).toBe(true);
      expect(validateCommandOutput('marketplaces.list', { marketplaces: [{ name: 'm', source: 'directory', locator: '/m', installLocation: '/m' }] }).ok).toBe(true);
    });
  });
  // E8 end
  // P2-B start (2026-10-09): the additive plugin fields and `plugins.manifest` (P2-B execution document §7)
  describe('P2-B entries', () => {
    const cwd = '/r';
    const emptyComponents = { mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [] };
    const view = { key: { kind: 'installation', id: 'p@m', scope: 'user', projectPath: null }, state: 'read', name: 'p', displayName: null, version: '1.0.0', marketplaceVersion: null, description: null, author: null, license: null, keywords: [], components: emptyComponents, partial: false, problems: [] };

    it('plugins.manifest is an engine-host read named in the bridge’s list', () => {
      expect(plugins.commands['plugins.manifest'].owner).toBe('engine-host');
      expect(NAMES.plugins.commands).toContain('plugins.manifest');
    });

    it('takes a cwd and at most 256 items, each an installation or an available entry, never a path or an option', () => {
      const installation = { kind: 'installation', id: 'p@m', scope: 'project', projectPath: '/r' };
      expect(validateCommandInput('plugins.manifest', { cwd, items: [installation, { kind: 'available', pluginId: 'q@m' }] }).ok).toBe(true);
      expect(validateCommandInput('plugins.manifest', { cwd, items: Array.from({ length: 257 }, () => installation) }).ok).toBe(false);
      expect(validateCommandInput('plugins.manifest', { cwd, items: [{ kind: 'available', pluginId: '-y' }] }).ok).toBe(false);
      expect(validateCommandInput('plugins.manifest', { cwd, items: [{ kind: 'path', path: '/etc' }] }).ok).toBe(false);
      expect(validateCommandInput('plugins.manifest', { cwd, items: [{ ...installation, installPath: '/etc' }] }).ok).toBe(false);
      expect(validateCommandInput('plugins.manifest', { cwd: 'relative', items: [] }).ok).toBe(false);
    });

    it('answers views of names, kinds and counts; nothing else crosses', () => {
      expect(validateCommandOutput('plugins.manifest', { manifests: [view] }).ok).toBe(true);
      expect(validateCommandOutput('plugins.manifest', { manifests: [{ ...view, state: 'unknown', components: { ...emptyComponents, mcpServers: [{ name: 's', transport: 'stdio' }] } }] }).ok).toBe(true);
      expect(validateCommandOutput('plugins.manifest', { manifests: [{ ...view, components: { ...emptyComponents, mcpServers: [{ name: 's', transport: 'stdio', command: 'npx' }] } }] }).ok).toBe(false);
      expect(validateCommandOutput('plugins.manifest', { manifests: [{ ...view, icon: 'x.png' }] }).ok).toBe(false);
      expect(validateCommandOutput('plugins.manifest', { manifests: [{ ...view, state: 'stale' }] }).ok).toBe(false);
    });

    it('an available row carries its source reduced and the CLI’s own install count, always said', () => {
      const row = { pluginId: 'p@m', name: 'p', marketplaceName: 'm', description: null, version: null };
      expect(validateCommandOutput('plugins.available', { plugins: [{ ...row, source: './plugins/p', installCount: 1290640 }] }).ok).toBe(true);
      expect(validateCommandOutput('plugins.available', { plugins: [{ ...row, source: { kind: 'git-subdir', url: 'https://github.com/a/b', repo: null, path: 'plugins/p' }, installCount: null }] }).ok).toBe(true);
      expect(validateCommandOutput('plugins.available', { plugins: [{ ...row, source: { kind: 'url', url: 'https://x', repo: null, path: null, sha: 'f' }, installCount: null }] }).ok).toBe(false);
      expect(validateCommandOutput('plugins.available', { plugins: [{ ...row, source: { kind: 'github', url: null, repo: 'a/b', path: null, ref: 'v2' }, installCount: null }] }).ok).toBe(true); // the architect's ref
      expect(validateCommandOutput('plugins.available', { plugins: [{ ...row, source: { kind: 'github', url: null, repo: 'a/b', path: null, ref: 7 }, installCount: null }] }).ok).toBe(false);
      expect(validateCommandOutput('plugins.available', { plugins: [{ ...row, source: null, installCount: -1 }] }).ok).toBe(false);
      expect(validateCommandOutput('plugins.available', { plugins: [row] }).ok).toBe(false);
    });
  });
  // P2-B end
  // E5 start: the quit guard names unsaved files (E5 execution document, Interfaces "The quit guard and unsaved files (M5)")
  describe('E5 layout entries', () => {
    it('layout.unsavedFiles and layout.saveAllDone are main’s bridged commands and layout.saveAll an event; the busy report always names the unsaved files', () => {
      for (const name of ['layout.unsavedFiles', 'layout.saveAllDone'] as const) {
        expect(commands[name].owner, name).toBe('main');
        expect(NAMES.layout.commands, name).toContain(name);
      }
      expect(NAMES.layout.events).toContain('layout.saveAll');

      const report = { midTurn: 0, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false, unsavedFiles: ['/r/a.ts'] };
      expect(validateEventPayload('layout.quitWait', { waiting: report }).ok).toBe(true);
      expect(validateEventPayload('layout.quitWait', { waiting: { ...report, unsavedFiles: [] } }).ok).toBe(true);
      const withoutFiles = { midTurn: 0, backgroundWork: 0, busyTerminals: 0, terminalsUnknown: false };
      expect(validateEventPayload('layout.quitWait', { waiting: withoutFiles }).ok).toBe(false); // always said, never defaulted
      expect(validateEventPayload('layout.quitWait', { waiting: { ...report, unsavedFiles: [1] } }).ok).toBe(false);

      expect(validateCommandInput('layout.unsavedFiles', { paths: ['/r/a.ts', '/r/b.ts'] }).ok).toBe(true);
      expect(validateCommandInput('layout.unsavedFiles', { paths: [] }).ok).toBe(true);
      expect(validateCommandInput('layout.unsavedFiles', { paths: [1] }).ok).toBe(false);
      expect(validateCommandInput('layout.unsavedFiles', {}).ok).toBe(false);
      expect(validateCommandOutput('layout.unsavedFiles', undefined).ok).toBe(true);

      expect(validateCommandInput('layout.saveAllDone', { requestId: 'r1', failed: [{ path: '/r/a.ts', message: 'Changed on disk since you opened it' }] }).ok).toBe(true);
      expect(validateCommandInput('layout.saveAllDone', { requestId: 'r1', failed: [] }).ok).toBe(true);
      expect(validateCommandInput('layout.saveAllDone', { requestId: 'r1', failed: [{ path: '/r/a.ts' }] }).ok).toBe(false);
      expect(validateCommandInput('layout.saveAllDone', { failed: [] }).ok).toBe(false);
      expect(validateCommandOutput('layout.saveAllDone', undefined).ok).toBe(true);

      expect(validateEventPayload('layout.saveAll', { requestId: 'r1' }).ok).toBe(true);
      expect(validateEventPayload('layout.saveAll', {}).ok).toBe(false);
      expect(validateEventPayload('layout.saveAll', { requestId: 'r1', paths: [] }).ok).toBe(false);
    });
  });
  // E5 end
  // E1 start: the maws tool server's commands and its pane request (P1 ledger §5)
  describe('E1 entries', () => {
    it('adds the maws namespace: three engine-host commands and the pane request, all bridged', () => {
      expect(Object.keys(maws.commands)).toEqual(['maws.asks.list', 'maws.ask.answer', 'maws.pane.answer', 'maws.artifact.captured' /* E2 */, 'maws.download.recorded' /* E13 */]);
      for (const spec of Object.values(maws.commands)) expect(spec.owner).toBe('engine-host');
      expect(Object.keys(maws.events)).toEqual(['maws.pane.show', 'maws.artifact.capture' /* E2 */]);
      expect([...NAMES.maws.commands]).toEqual(Object.keys(maws.commands));
    });

    it('validates the asks, an answer, a pane request and its answer', () => {
      const ask = { askId: 'toolu_1', toolUseId: 'toolu_1', requestId: 'r1', blocking: true, title: null, context: null, questions: [{ id: 'q1', question: 'Q?', modality: 'text' }], openedAt: '2026-10-05T00:00:00.000Z' };
      expect(validateCommandOutput('maws.asks.list', { asks: [ask] }).ok).toBe(true);
      expect(validateCommandInput('maws.ask.answer', { appSessionId: 'a', askId: 'toolu_1', answers: [{ id: 'q1', question: 'Q?', status: 'skipped' }] }).ok).toBe(true);
      expect(validateCommandOutput('maws.ask.answer', { outcome: 'write_failed' }).ok).toBe(true);
      expect(validateEventPayload('maws.pane.show', { appSessionId: 'a', requestId: 'r1', pane: 'file', target: '/r/a.ts', line: 3 }).ok).toBe(true);
      expect(validateEventPayload('maws.pane.show', { appSessionId: 'a', requestId: 'r1', pane: 'nope', target: null, line: null }).ok).toBe(false);
      expect(validateCommandInput('maws.pane.answer', { appSessionId: 'a', requestId: 'r1', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 't', title: 'Terminal' } } }).ok).toBe(true);
      expect(validateCommandInput('maws.pane.answer', { appSessionId: 'a', requestId: 'r1', result: { ok: false, error: 'show_pane: the deliverable pane is not available in this build of MAWS' } }).ok).toBe(true);
      expect(validateCommandInput('maws.pane.answer', { appSessionId: 'a', requestId: 'r1', result: { ok: false } }).ok).toBe(false);
      expect(validateCommandOutput('maws.pane.answer', { outcome: 'write_failed' }).ok).toBe(false);
    });
  });
  // E1 end
  // E6 start: source control (E6 execution document, Interfaces "X2 `scm.*`")
  describe('E6 entries', () => {
    const appSessionId = 'a1111111-1111-4111-8111-111111111111';
    const token = '3f2b8c1e-6d4a-4f7b-9a1e-2c5d8e7f6a90';
    const status = {
      repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git', isWorktree: false, branch: 'main', head: 'abc', upstream: 'origin/main',
      remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-06T00:00:00.000Z',
    };
    const plan = {
      token, kind: 'push', cwd: '/r', program: '/usr/bin/git', argv: ['push', '--progress', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/heads/main'], remote: 'origin',
      remoteUrl: 'https://github.com/o/r', pushUrls: ['https://github.com/o/r'], repository: null, branch: 'main', head: 'abc', upstream: 'origin/main', expiresAt: '2026-10-06T00:05:00.000Z',
    };

    it('carries the E6 scm.* entries: twelve commands and one event, every command owned by main and bridged', () => {
      expect(Object.keys(scm.commands)).toEqual([
        'scm.status', 'scm.stage', 'scm.unstage', 'scm.discard', 'scm.commit', 'scm.push.plan', 'scm.push', 'scm.pr.plan', 'scm.pr.create',
        'scm.remote.cancel', 'scm.remote.last', 'scm.pr.state',
      ]);
      for (const spec of Object.values(scm.commands)) expect(spec.owner).toBe('main');
      expect(Object.keys(scm.events)).toEqual(['scm.remote.output']);
      expect([...NAMES.scm.commands]).toEqual(Object.keys(scm.commands));
      expect([...NAMES.scm.events]).toEqual(['scm.remote.output']);
    });

    it('scm.status takes a session, never a directory, and answers trust, remotes and the gh state', () => {
      const answer = { directory: '/r', repository: true, trusted: true, trustKey: '/r', remotes: [{ name: 'origin', url: null }], defaultRemote: 'origin', defaultBase: 'main', gh: { state: 'missing' }, checkedAt: 'now' };
      expect(validateCommandInput('scm.status', { appSessionId }).ok).toBe(true);
      expect(validateCommandInput('scm.status', { appSessionId, directory: '/r' }).ok).toBe(false);
      expect(validateCommandOutput('scm.status', answer)).toEqual({ ok: true, value: answer });
      expect(validateCommandOutput('scm.status', { ...answer, gh: { state: 'ready', path: '/bin/gh', version: 'gh version 2.97.0' } }).ok).toBe(true);
      expect(validateCommandOutput('scm.status', { ...answer, gh: { state: 'unauthenticated', path: '/bin/gh', version: null, detail: 'not logged in' } }).ok).toBe(true);
      expect(validateCommandOutput('scm.status', { ...answer, gh: { state: 'ready', path: '/bin/gh' } }).ok).toBe(false);
    });

    it('the local mutations take bounded paths, entries and a message, and answer a status or a refusal', () => {
      expect(validateCommandInput('scm.stage', { appSessionId, paths: ['src/app.ts'] }).ok).toBe(true);
      expect(validateCommandInput('scm.stage', { appSessionId, paths: [] }).ok).toBe(false);
      expect(validateCommandInput('scm.stage', { appSessionId, paths: [''] }).ok).toBe(false);
      expect(validateCommandInput('scm.stage', { appSessionId, paths: ['x'.repeat(4097)] }).ok).toBe(false);
      expect(validateCommandInput('scm.unstage', { appSessionId, paths: Array.from({ length: 1001 }, (_, i) => `f${i}`) }).ok).toBe(false);
      expect(validateCommandInput('scm.discard', { appSessionId, entries: [{ path: 'a', group: 'unstaged' }, { path: 'u/', group: 'untracked' }] }).ok).toBe(true);
      expect(validateCommandInput('scm.discard', { appSessionId, entries: [{ path: 'a', group: 'staged' }] }).ok).toBe(false);
      expect(validateCommandInput('scm.commit', { appSessionId, message: 'From the panel', noVerify: false }).ok).toBe(true);
      expect(validateCommandInput('scm.commit', { appSessionId, message: '', noVerify: false }).ok).toBe(false);
      expect(validateCommandInput('scm.commit', { appSessionId, message: 'x' }).ok).toBe(false);
      const ok = { ok: true, status, output: '' };
      expect(validateCommandOutput('scm.stage', ok)).toEqual({ ok: true, value: ok });
      expect(validateCommandOutput('scm.commit', { ...ok, commit: { sha: 'abc', subject: 'From the panel' } }).ok).toBe(true);
      for (const refused of scm.ScmRefusalCodeSchema.options) {
        expect(validateCommandOutput('scm.discard', { refused, detail: '', output: '' }).ok, refused).toBe(true);
      }
      expect(validateCommandOutput('scm.discard', { refused: 'forced', detail: '', output: '' }).ok).toBe(false);
      expect(validateCommandOutput('scm.stage', { ok: false, status, output: '' }).ok).toBe(false);
    });

    it('plans and runs carry one-shot tokens, and the output event its sequence number', () => {
      expect(validateCommandInput('scm.push.plan', { appSessionId }).ok).toBe(true);
      expect(validateCommandInput('scm.push.plan', { appSessionId, remote: '' }).ok).toBe(false);
      expect(validateCommandInput('scm.pr.plan', { appSessionId, title: 'Panel PR', body: '', base: 'main', draft: false }).ok).toBe(true);
      expect(validateCommandInput('scm.pr.plan', { appSessionId, title: '', body: '', base: 'main', draft: false }).ok).toBe(false);
      expect(validateCommandOutput('scm.push.plan', plan).ok).toBe(true);
      expect(validateCommandOutput('scm.pr.plan', { ...plan, kind: 'pr', program: '/bin/gh', repository: 'o/r' }).ok).toBe(true);
      expect(validateCommandOutput('scm.push.plan', { refused: 'behind', detail: 'Pull in a terminal first', output: '' }).ok).toBe(true);
      for (const name of ['scm.push', 'scm.pr.create', 'scm.remote.cancel'] as const) {
        expect(validateCommandInput(name, { appSessionId, token }).ok, name).toBe(true);
        expect(validateCommandInput(name, { appSessionId, token: 'not-a-uuid' }).ok, name).toBe(false);
      }
      expect(validateCommandOutput('scm.push', { started: true, token }).ok).toBe(true);
      expect(validateCommandOutput('scm.push', { refused: 'plan_expired', detail: '', output: '' }).ok).toBe(true);
      expect(validateCommandOutput('scm.remote.cancel', undefined).ok).toBe(true);
      const last = { token, kind: 'push', plan, running: false, exitCode: 0, signal: null, output: 'done', truncated: false, seq: 3, startedAt: 'then' };
      expect(validateCommandOutput('scm.remote.last', last)).toEqual({ ok: true, value: last });
      expect(validateCommandOutput('scm.remote.last', null).ok).toBe(true);
      expect(validateEventPayload('scm.remote.output', { appSessionId, token, seq: 1, kind: 'stdout', text: 'x' }).ok).toBe(true);
      expect(validateEventPayload('scm.remote.output', { appSessionId, token, seq: 2, kind: 'stderr', text: '', truncated: true }).ok).toBe(true);
      expect(validateEventPayload('scm.remote.output', { appSessionId, token, seq: 3, kind: 'exit', exitCode: null, signal: 'SIGTERM' }).ok).toBe(true);
      expect(validateEventPayload('scm.remote.output', { appSessionId, token, seq: 0, kind: 'stdout', text: 'x' }).ok).toBe(false);
      expect(validateEventPayload('scm.remote.output', { appSessionId, token, seq: 1, kind: 'progress', text: 'x' }).ok).toBe(false);
    });

    it('scm.pr.state answers the PR and its checks, or why there is none', () => {
      const pr = {
        number: 7, url: 'https://github.com/o/r/pull/7', title: 'Panel PR', state: 'OPEN', isDraft: false, reviewDecision: null, baseRefName: 'main', headRefName: 'feature',
        mergeStateStatus: 'CLEAN', checks: { summary: 'pending', items: [{ name: 'ci', bucket: 'pending', state: 'IN_PROGRESS', link: null, workflow: 'CI' }] },
      };
      const answer = { checkedAt: 'now', branch: 'feature', gh: { state: 'missing' }, pr, error: null };
      expect(validateCommandInput('scm.pr.state', { appSessionId, refresh: true }).ok).toBe(true);
      expect(validateCommandInput('scm.pr.state', { appSessionId }).ok).toBe(false);
      expect(validateCommandOutput('scm.pr.state', answer)).toEqual({ ok: true, value: answer });
      expect(validateCommandOutput('scm.pr.state', { ...answer, pr: null, error: 'untrusted' }).ok).toBe(true);
      expect(validateCommandOutput('scm.pr.state', { ...answer, pr: { ...pr, state: 'DRAFT' } }).ok).toBe(false);
      expect(validateCommandOutput('scm.pr.state', { ...answer, pr: { ...pr, checks: { summary: 'pending', items: [{ ...pr.checks.items[0], bucket: 'queued' }] } } }).ok).toBe(false);
    });
  });
  // E6 end
  // E3 start: anchored comments and side questions (P1 ledger §5)
  describe('E3 entries', () => {
    const anchor = { kind: 'file-line', locator: '/r/a.ts#L3', label: 'a.ts:3', path: '/r/a.ts', line: 3 };
    it('adds the side namespace: three main commands (E11 F2b: the screenshot preview), two engine-host commands, no event', () => {
      expect(Object.fromEntries(Object.entries(side.commands).map(([name, spec]) => [name, spec.owner]))).toEqual({
        'side.thread.open': 'main', 'side.sendToMain': 'main', 'side.screenshot.preview': 'main', 'side.question.list': 'engine-host', 'side.question.clear': 'engine-host',
      });
      expect([...NAMES.side.commands]).toEqual(Object.keys(side.commands));
      expect(Object.keys(side.events)).toEqual([]);
    });

    it('opens a side thread from a comment or from answered side questions, and answers StartOutcome', () => {
      expect(validateCommandInput('side.thread.open', { appSessionId: 'a', from: { kind: 'comment', anchor, text: 'why?', screenshot: null } }).ok).toBe(true);
      expect(validateCommandInput('side.thread.open', { appSessionId: 'a', from: { kind: 'comment', anchor, text: 'why?', screenshot: { path: '/u/s.png', width: 2, height: 2 } } }).ok).toBe(true);
      expect(validateCommandInput('side.thread.open', { appSessionId: 'a', from: { kind: 'btw', exchanges: [{ question: 'q', response: 'r' }], text: null } }).ok).toBe(true);
      expect(validateCommandInput('side.thread.open', { appSessionId: 'a', from: { kind: 'btw', exchanges: [], text: null } }).ok).toBe(false);
      // M1's review: an engine answer is capped too (the promotion message must fit the 1 MiB send bound)
      expect(validateCommandInput('side.thread.open', { appSessionId: 'a', from: { kind: 'btw', exchanges: [{ question: 'q', response: 'r'.repeat(100_000) }], text: null } }).ok).toBe(true);
      expect(validateCommandInput('side.thread.open', { appSessionId: 'a', from: { kind: 'btw', exchanges: [{ question: 'q', response: 'r'.repeat(100_001) }], text: null } }).ok).toBe(false);
      expect(validateCommandInput('side.thread.open', { appSessionId: 'a', from: { kind: 'comment', anchor, text: 'x'.repeat(20_001), screenshot: null } }).ok).toBe(false);
      expect(validateCommandInput('side.thread.open', { appSessionId: 'a', from: { kind: 'comment', anchor: { ...anchor, label: 'a\nb' }, text: 'x', screenshot: null } }).ok).toBe(false);
      expect(validateCommandOutput('side.thread.open', { status: 'starting', appSessionId: 'child' }).ok).toBe(true);
    });

    it('sends to main with its disposition, and lists the host’s side questions', () => {
      expect(validateCommandInput('side.sendToMain', { appSessionId: 'a', anchor, text: 'look', screenshot: null }).ok).toBe(true);
      expect(validateCommandOutput('side.sendToMain', { messageUuid: null, disposition: 'queued' }).ok).toBe(true);
      expect(validateCommandOutput('side.sendToMain', { messageUuid: null, disposition: 'dropped' }).ok).toBe(false);
      const exchange = { id: 'r1', question: 'q', state: 'answered', response: 'ZEBRA', synthetic: false, error: null, askedAt: 't0', answeredAt: 't1' };
      expect(validateCommandOutput('side.question.list', { exchanges: [exchange] }).ok).toBe(true);
      expect(validateCommandOutput('side.question.list', { exchanges: [{ ...exchange, state: 'done' }] }).ok).toBe(false);
      expect(validateCommandOutput('side.question.clear', {}).ok).toBe(true);
    });
  });
  // E3 end
  // E2 start: the store's reads, its change and console events, and the capture bridge (P1 ledger §5)
  describe('E2 entries', () => {
    const ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
    const record = { id: ID, appSessionId: 'a', kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: `/u/${ID}/v1.html`, versions: [{ path: `/u/${ID}/v1.html`, at: 't', toolUseId: 'toolu_1', sourcePath: '/r/d.html' }], createdAt: 't', updatedAt: 't' };

    it('adds the deliverables namespace: three main-owned reads and two events, all bridged; the capture pair under maws', () => {
      expect(Object.keys(deliverables.commands)).toEqual(['deliverables.list', 'deliverables.listAll', 'deliverables.get']);
      for (const spec of Object.values(deliverables.commands)) expect(spec.owner).toBe('main');
      expect(Object.keys(deliverables.events)).toEqual(['deliverables.changed', 'deliverables.console']);
      expect([...NAMES.deliverables.commands]).toEqual(Object.keys(deliverables.commands));
      expect([...NAMES.deliverables.events]).toEqual(Object.keys(deliverables.events));
      expect(commands['maws.artifact.captured'].owner).toBe('engine-host');
    });

    it('validates the reads, the change and console events, a capture request and its answers', () => {
      expect(validateCommandInput('deliverables.list', { appSessionId: 'a' }).ok).toBe(true);
      expect(validateCommandOutput('deliverables.list', { records: [record] }).ok).toBe(true);
      expect(validateCommandInput('deliverables.listAll', {}).ok).toBe(true);
      expect(validateCommandInput('deliverables.listAll', { limit: 500 }).ok).toBe(true);
      expect(validateCommandInput('deliverables.listAll', { limit: 501 }).ok).toBe(false);
      expect(validateCommandInput('deliverables.listAll', { limit: 0 }).ok).toBe(false);
      expect(validateCommandInput('deliverables.get', { appSessionId: 'a', id: ID }).ok).toBe(true);
      expect(validateCommandOutput('deliverables.get', { record, present: [true] }).ok).toBe(true);
      expect(validateCommandOutput('deliverables.get', { record: null, present: [] }).ok).toBe(true);
      expect(validateEventPayload('deliverables.changed', { appSessionId: 'a', id: ID, change: 'updated' }).ok).toBe(true);
      expect(validateEventPayload('deliverables.changed', { appSessionId: 'a', id: ID, change: 'deleted' }).ok).toBe(false);
      expect(validateEventPayload('deliverables.console', { appSessionId: 'a', deliverableId: ID, version: 1, level: 'error', message: 'Uncaught Error: E2_BOOM', line: 3, source: null }).ok).toBe(true);
      expect(validateEventPayload('deliverables.console', { appSessionId: 'a', deliverableId: ID, version: 1, level: 'info', message: 'x', line: null, source: null }).ok).toBe(false);
      expect(validateEventPayload('maws.artifact.capture', { appSessionId: 'a', requestId: 'r1', deliverableId: ID, version: 2, width: 1280, height: 800 }).ok).toBe(true);
      expect(validateEventPayload('maws.artifact.capture', { appSessionId: 'a', requestId: 'r1', deliverableId: 'dash', version: 2, width: 1280, height: 800 }).ok).toBe(false);
      expect(validateCommandInput('maws.artifact.captured', { appSessionId: 'a', requestId: 'r1', result: { ok: true, png: 'iVBO', width: 64, height: 64, consoleErrors: [] } }).ok).toBe(true);
      expect(validateCommandInput('maws.artifact.captured', { appSessionId: 'a', requestId: 'r1', result: { ok: false, error: 'did-fail-load' } }).ok).toBe(true);
      expect(validateCommandInput('maws.artifact.captured', { appSessionId: 'a', requestId: 'r1', result: { ok: true, png: 'iVBO' } }).ok).toBe(false);
      expect(validateCommandOutput('maws.artifact.captured', { outcome: 'not_pending' }).ok).toBe(true);
    });
  });
  // E2 end
  // E10 start: the supervisor's own facts (engine host) and what the app shows of it (main); P1 ledger §5 `host.*`
  describe('E10 entries', () => {
    const supervisor = {
      mode: 'detached', pid: 4321, startedAt: '2026-10-06T10:00:00.000Z', buildId: '0123456789abcdef', protocol: 1, wire: 'fedcba9876543210', liveSessions: 1, rows: 2,
      idleExitMs: 600_000, idleExitAt: null, exitWhenIdle: false, socketPath: '/u/supervisor/host.sock', logPath: '/u/supervisor/host.log', orphansKilled: 0,
    };
    const status = { transport: 'detached', state: 'ready', supervisor, appBuildId: '0123456789abcdef', appWire: 'fedcba9876543210', mainBuild: { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' }, matches: 'same', reason: null, waitingLiveSessions: null, lastExit: null };

    it('adds the host namespace: four engine-host commands (three main-only senders), three main-owned, one event each side', () => {
      expect(Object.keys(host.commands)).toEqual(['host.supervisorStatus', 'host.configure', 'host.stopAll', 'host.exitWhenIdle', 'host.status', 'host.restart', 'host.openLog']);
      const owners = Object.fromEntries(Object.entries(host.commands).map(([name, spec]) => [name, spec.owner]));
      expect(owners).toEqual({
        'host.supervisorStatus': 'engine-host', 'host.configure': 'engine-host', 'host.stopAll': 'engine-host', 'host.exitWhenIdle': 'engine-host',
        'host.status': 'main', 'host.restart': 'main', 'host.openLog': 'main',
      });
      expect(Object.keys(host.events)).toEqual(['host.supervisorStatus', 'host.status']);
      // only main stops, configures or arms the supervisor: a renderer's stopAll would read as a crash to main's transport
      expect(MAIN_ONLY_COMMANDS).toEqual(expect.arrayContaining(['host.configure', 'host.stopAll', 'host.exitWhenIdle']));
      expect([...NAMES.host.commands]).toEqual(['host.supervisorStatus', 'host.status', 'host.restart', 'host.openLog']);
    });

    it('validates the supervisor status, its commands and the app-side status', () => {
      expect(validateCommandOutput('host.supervisorStatus', supervisor).ok).toBe(true);
      expect(validateEventPayload('host.supervisorStatus', supervisor).ok).toBe(true);
      expect(validateEventPayload('host.supervisorStatus', { ...supervisor, mode: 'utility', socketPath: null, logPath: null, idleExitMs: null }).ok).toBe(true);
      expect(validateEventPayload('host.supervisorStatus', { ...supervisor, idleExitAt: '2026-10-06T10:10:00.000Z' }).ok).toBe(true);
      expect(validateEventPayload('host.supervisorStatus', { ...supervisor, mode: 'remote' }).ok).toBe(false);
      expect(validateEventPayload('host.supervisorStatus', { ...supervisor, extra: 1 }).ok).toBe(false);
      expect(validateCommandInput('host.configure', { idleExitMs: 600_000 }).ok).toBe(true);
      expect(validateCommandInput('host.configure', { idleExitMs: null }).ok).toBe(true);
      expect(validateCommandInput('host.configure', { idleExitMs: 0 }).ok).toBe(false);
      expect(validateCommandInput('host.configure', { idleExitMs: 1.5 }).ok).toBe(false);
      // settings' 1440 minutes at most: past 2^31 - 1 ms Node clamps a timer to 1 ms and both idle clocks would spin
      expect(validateCommandInput('host.configure', { idleExitMs: 1440 * 60_000 }).ok).toBe(true);
      expect(validateCommandInput('host.configure', { idleExitMs: 1440 * 60_000 + 1 }).ok).toBe(false);
      expect(validateCommandInput('host.configure', { idleExitMs: 2 ** 31 }).ok).toBe(false);
      expect(validateEventPayload('host.supervisorStatus', { ...supervisor, idleExitMs: 1440 * 60_000 + 1 }).ok).toBe(false);
      expect(validateCommandInput('host.stopAll', { graceMs: 5000 }).ok).toBe(true);
      expect(validateCommandInput('host.stopAll', { graceMs: -1 }).ok).toBe(false);
      expect(validateCommandOutput('host.stopAll', { stopped: 2, forced: 0 }).ok).toBe(true);
      expect(validateCommandInput('host.exitWhenIdle', { armed: true }).ok).toBe(true);
      expect(validateCommandInput('host.exitWhenIdle', {}).ok).toBe(false);
      expect(validateCommandOutput('host.status', status).ok).toBe(true);
      expect(validateEventPayload('host.status', { ...status, supervisor: null, matches: null, state: 'crashed', reason: 'held_lock' }).ok).toBe(true);
      expect(validateEventPayload('host.status', { ...status, lastExit: { code: null, signal: 'SIGKILL', at: 't', interrupted: 2 } }).ok).toBe(true);
      expect(validateEventPayload('host.status', { ...status, matches: 'other' }).ok).toBe(false);
      // E11 §2.7: main's own build, apart from the engine-host bundle's appBuildId
      expect(validateEventPayload('host.status', { ...status, mainBuild: undefined }).ok).toBe(false);
      expect(validateEventPayload('host.status', { ...status, mainBuild: { ...status.mainBuild, extra: 1 } }).ok).toBe(false);
      // E10 Task 2.4: the live count an incompatible supervisor reported, for the banner's N; main-owned, off the wire
      const waiting = { ...status, supervisor: null, matches: 'wire', state: 'crashed', reason: 'incompatible', waitingLiveSessions: 2 };
      expect(validateEventPayload('host.status', waiting).ok).toBe(true);
      expect(validateEventPayload('host.status', { ...waiting, waitingLiveSessions: 1.5 }).ok).toBe(false);
      expect(validateEventPayload('host.status', { ...status, waitingLiveSessions: undefined }).ok).toBe(false);
      expect(validateCommandInput('host.restart', { stopSessions: true }).ok).toBe(true);
      expect(validateCommandInput('host.restart', {}).ok).toBe(false);
      expect(validateCommandInput('host.openLog', undefined).ok).toBe(true);
    });
  });
  // E10 end
  // E4a start: the browser view's commands and events (P1 ledger §5; E4a execution document, Interfaces "IPC")
  describe('E4a entries', () => {
    const TAB_ID = 'b_0123456789ab';
    const tab = {
      tabId: TAB_ID, appSessionId: 'a', partition: 'persist:maws-browser', url: 'https://example.com/', title: 'Example', favicon: null,
      loading: false, canGoBack: false, canGoForward: false, zoom: 1, control: 'idle', controlSince: 't', suspended: true,
      loadError: null, crashed: null, failed: null, unresponsive: false, blockedPopups: 0, find: null, denied: [], download: null,
      memoryKiB: null, placedIn: null, covered: false, createdAt: 't', lastShownAt: 't', agentBadge: null /* E13 */, internal: null /* cua #90 */,
    };

    it('adds the browser namespace, main-owned throughout, every name bridged', () => {
      expect(Object.keys(browser.commands).filter((name) => !name.startsWith('browser.import.') && !name.startsWith('browser.bookmarks.') && !name.startsWith('browser.extensions.') && name !== 'browser.view.capture') /* E4b, cua #90: their blocks are pinned below; P3-G appended last */).toEqual([
        'browser.tabs.list', 'browser.tabs.open', 'browser.tabs.close', 'browser.tabs.select', 'browser.tabs.navigate', 'browser.tabs.zoom',
        'browser.tabs.find', 'browser.tabs.dismiss', 'browser.tabs.devtools', 'browser.tabs.revealDownload', 'browser.view.place',
        'browser.view.cover', 'browser.control.handBack', 'browser.history.suggest', 'browser.profiles.list',
        'browser.comment.set' /* E4d */,
        'browser.agent.activities.list' /* E13 */,
      ]);
      for (const spec of Object.values(browser.commands)) expect(spec.owner).toBe('main');
      expect(Object.keys(browser.events).filter((name) => !name.startsWith('browser.import.') && !name.startsWith('browser.bookmarks.') && !name.startsWith('browser.extensions.')) /* E4b, cua #90 */).toEqual([
        'browser.tabs.changed', 'browser.view.covered', 'browser.control.changed', 'browser.chrome.command', 'browser.download.refused', 'browser.notice',
        'browser.comment.changed', 'browser.comment.picked' /* E4d */,
        'browser.agent.acting', // E4c, restored by E13 (P1 A-54)
        'browser.agent.activity', // E13
      ]);
      expect([...NAMES.browser.commands]).toEqual(Object.keys(browser.commands));
      expect([...NAMES.browser.events]).toEqual(Object.keys(browser.events));
    });

    it('takes only http and https URLs, with no whitespace, and only well-formed tab ids', () => {
      const open = { appSessionId: 'a', url: 'https://example.com/', select: true };
      expect(validateCommandInput('browser.tabs.open', open).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.open', { ...open, url: null, reuse: 'url', requestId: 'r1' }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.open', { ...open, url: 'http://localhost:3000/x' }).ok).toBe(true);
      for (const url of ['http://example.com/a b', 'http://exa mple.com/', ' http://example.com/', 'file:///etc/hosts', 'javascript:1', 'about:blank', 'maws-deliverable://x/y/1', 'ftp://x/'])
        expect(validateCommandInput('browser.tabs.open', { ...open, url }).ok, url).toBe(false);
      expect(validateCommandInput('browser.tabs.open', { ...open, reuse: 'title' }).ok).toBe(false);
      expect(validateCommandOutput('browser.tabs.open', { tab, reused: false }).ok).toBe(true);
      expect(validateCommandOutput('browser.tabs.open', { tab: { ...tab, extra: 1 }, reused: false }).ok).toBe(false);
      for (const tabId of ['b_0123', 'B_0123456789ab', 'b_0123456789AB', 'tab-1', ''])
        expect(validateCommandInput('browser.tabs.close', { tabId }).ok, tabId).toBe(false);
      expect(validateCommandInput('browser.tabs.close', { tabId: TAB_ID }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.navigate', { tabId: TAB_ID, to: { url: 'https://a.b/', typed: true } }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.navigate', { tabId: TAB_ID, to: 'reload' }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.navigate', { tabId: TAB_ID, to: { url: 'file:///x' } }).ok).toBe(false);
      expect(validateCommandInput('browser.tabs.navigate', { tabId: TAB_ID, to: 'home' }).ok).toBe(false);
      expect(validateCommandOutput('browser.tabs.navigate', { accepted: true }).ok).toBe(true);
    });

    it('validates the list, the chrome commands and the history and profile reads', () => {
      expect(validateCommandInput('browser.tabs.list', {}).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.list', { appSessionId: 'a' }).ok).toBe(true);
      expect(validateCommandOutput('browser.tabs.list', { tabs: [tab], selected: { a: TAB_ID, b: null } }).ok).toBe(true);
      expect(validateCommandOutput('browser.tabs.list', { tabs: [], selected: { a: 'nope' } }).ok).toBe(false);
      expect(validateCommandInput('browser.tabs.select', { appSessionId: 'a', tabId: TAB_ID }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.zoom', { tabId: TAB_ID, action: 'in' }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.zoom', { tabId: TAB_ID, action: 'max' }).ok).toBe(false);
      expect(validateCommandOutput('browser.tabs.zoom', { zoom: 1.25 }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.find', { tabId: TAB_ID, text: 'needle', forward: true, findNext: false, matchCase: false }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.find', { tabId: TAB_ID, text: null }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.dismiss', { tabId: TAB_ID, notice: 'popups' }).ok).toBe(true);
      expect(validateCommandInput('browser.tabs.dismiss', { tabId: TAB_ID, notice: 'tabsCap' }).ok).toBe(false);
      expect(validateCommandInput('browser.tabs.devtools', { tabId: TAB_ID }).ok).toBe(true);
      expect(validateCommandOutput('browser.tabs.revealDownload', { revealed: false }).ok).toBe(true);
      expect(validateCommandInput('browser.control.handBack', { tabId: TAB_ID }).ok).toBe(true);
      expect(validateCommandInput('browser.history.suggest', { partition: 'persist:maws-browser', query: 'wiki' }).ok).toBe(true);
      expect(validateCommandInput('browser.history.suggest', { partition: 'persist:maws-chrome-Profile 1', query: '' }).ok).toBe(true);
      expect(validateCommandInput('browser.history.suggest', { partition: 'persist:maws-capture', query: 'wiki' }).ok).toBe(false);
      expect(validateCommandOutput('browser.history.suggest', { suggestions: [{ url: 'https://a.b/', title: null, kind: 'history' }] }).ok).toBe(true); // cua #90: `kind`
      expect(validateCommandOutput('browser.history.suggest', { suggestions: [{ url: 'https://a.b/', title: null }] }).ok).toBe(false);
      expect(validateCommandInput('browser.profiles.list', undefined).ok).toBe(true);
      // cua #90: the account's names and the avatar, a PNG data URL or an initial
      const item = { profileDir: 'Default', name: 'Work', gaiaName: 'Probe Owner', userName: 'probe@example.test', avatar: { kind: 'picture', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' } };
      expect(validateCommandOutput('browser.profiles.list', { profiles: [item, { ...item, gaiaName: null, userName: null, avatar: { kind: 'initials', letter: 'W' } }] }).ok).toBe(true);
      expect(validateCommandOutput('browser.profiles.list', { profiles: [{ profileDir: 'Default', name: 'Work' }] }).ok).toBe(false);
      expect(validateCommandOutput('browser.profiles.list', { profiles: [{ ...item, avatar: { kind: 'picture', dataUrl: 'https://a.test/x.png' } }] }).ok).toBe(false);
      expect(validateCommandOutput('browser.profiles.list', { profiles: [{ ...item, avatar: { kind: 'picture', dataUrl: `data:image/png;base64,${'A'.repeat(400_000)}` } }] }).ok).toBe(false);
    });

    it('takes a placement as an integer rect of at least one pixel, or null, from a named pane', () => {
      const place = { tabId: TAB_ID, paneId: 'p1', surface: 'panel', rect: { x: 10, y: 20, width: 300, height: 200 }, claim: true };
      expect(validateCommandInput('browser.view.place', place).ok).toBe(true);
      expect(validateCommandInput('browser.view.place', { ...place, rect: null, claim: false }).ok).toBe(true);
      expect(validateCommandInput('browser.view.place', { ...place, rect: { ...place.rect, x: 10.5 } }).ok).toBe(false);
      expect(validateCommandInput('browser.view.place', { ...place, rect: { ...place.rect, width: 0 } }).ok).toBe(false);
      expect(validateCommandInput('browser.view.place', { ...place, surface: 'sidebar' }).ok).toBe(false);
      expect(validateCommandInput('browser.view.place', { ...place, paneId: '' }).ok).toBe(false);
      expect(validateCommandInput('browser.view.cover', { covered: true }).ok).toBe(true);
      expect(validateCommandInput('browser.view.cover', { covered: true, tabId: TAB_ID }).ok).toBe(false);
    });

    it('validates the events', () => {
      expect(validateEventPayload('browser.tabs.changed', { appSessionId: 'a', tabs: [tab], selected: TAB_ID }).ok).toBe(true);
      expect(validateEventPayload('browser.tabs.changed', { appSessionId: 'a', tabs: [], selected: null }).ok).toBe(true);
      expect(validateEventPayload('browser.view.covered', { tabId: TAB_ID, placeholder: 'data:image/jpeg;base64,/9j/4AAQ' }).ok).toBe(true);
      expect(validateEventPayload('browser.view.covered', { tabId: TAB_ID, placeholder: null }).ok).toBe(true);
      expect(validateEventPayload('browser.view.covered', { tabId: TAB_ID, placeholder: 'https://example.com/x.jpg' }).ok).toBe(false);
      expect(validateEventPayload('browser.view.covered', { tabId: TAB_ID, placeholder: `data:image/jpeg;base64,${'A'.repeat(560_000)}` }).ok).toBe(false);
      expect(validateEventPayload('browser.control.changed', { tabId: TAB_ID, control: 'idle', controlSince: 't' }).ok).toBe(true);
      expect(validateEventPayload('browser.chrome.command', { tabId: TAB_ID, command: 'openFind' }).ok).toBe(true);
      expect(validateEventPayload('browser.chrome.command', { tabId: TAB_ID, command: 'print' }).ok).toBe(false);
      expect(validateEventPayload('browser.download.refused', { tabId: TAB_ID, url: 'https://a.b/f.bin', filename: 'f.bin' }).ok).toBe(true);
      expect(validateEventPayload('browser.notice', { appSessionId: 'a', tabId: null, kind: 'tabsCap', count: 12 }).ok).toBe(true);
      expect(validateEventPayload('browser.notice', { appSessionId: 'a', tabId: TAB_ID, kind: 'profileMissing', name: 'Work' }).ok).toBe(true);
      expect(validateEventPayload('browser.notice', { appSessionId: 'a', tabId: null, kind: 'urlCopied' }).ok).toBe(false);
    });
  });
  // E4a end
  // E4d start: comment mode's command and events (E4d execution document, Interfaces "IPC `browser.comment.*`")
  describe('E4d entries', () => {
    const TAB_ID = 'b_0123456789ab';
    const anchor = { kind: 'browser-element', locator: '#increment', label: 'button “Increment”', pageUrl: 'http://127.0.0.1:4321/comment.html', css: '#increment', role: 'button', name: 'Increment', a11y: 'main > button “Increment”', box: { x: 1, y: 2, width: 3, height: 4 } };

    it('appends one command and two events to the browser namespace, main-owned, every name bridged', () => {
      expect(Object.keys(browser.commands).filter((name) => name.startsWith('browser.comment.'))).toEqual(['browser.comment.set']);
      expect(browser.commands['browser.comment.set'].owner).toBe('main');
      expect(Object.keys(browser.events).filter((name) => name.startsWith('browser.comment.'))).toEqual(['browser.comment.changed', 'browser.comment.picked']);
      expect(NAMES.browser.commands).toContain('browser.comment.set');
      expect(NAMES.browser.events).toEqual(expect.arrayContaining(['browser.comment.changed', 'browser.comment.picked']));
    });

    it('validates the toggle and its answer', () => {
      expect(validateCommandInput('browser.comment.set', { tabId: TAB_ID, on: true }).ok).toBe(true);
      for (const tabId of ['b_0123', 'tab-1', '', 7]) expect(validateCommandInput('browser.comment.set', { tabId, on: true }).ok, String(tabId)).toBe(false);
      expect(validateCommandInput('browser.comment.set', { tabId: TAB_ID, on: 'yes' }).ok).toBe(false);
      expect(validateCommandInput('browser.comment.set', { tabId: TAB_ID, on: true, mode: 'area' }).ok).toBe(false);
      for (const reason of ['ok', 'unknownTab', 'suspended', 'notPlaced', 'noPage', 'agent', 'arming']) expect(validateCommandOutput('browser.comment.set', { on: reason === 'ok', reason }).ok, reason).toBe(true);
      expect(validateCommandOutput('browser.comment.set', { on: false, reason: 'busy' }).ok).toBe(false);
    });

    it('validates the mode’s change and the pick', () => {
      for (const reason of ['armed', 'toggle', 'picked', 'escape', 'navigated', 'agent', 'closed', 'crashed', 'refused', 'other', 'unavailable'])
        expect(validateEventPayload('browser.comment.changed', { tabId: TAB_ID, on: reason === 'armed', reason }).ok, reason).toBe(true);
      expect(validateEventPayload('browser.comment.changed', { tabId: TAB_ID, on: false, reason: 'blurred' }).ok).toBe(false);
      expect(validateEventPayload('browser.comment.changed', { tabId: 'nope', on: false, reason: 'toggle' }).ok).toBe(false);
      const picked = { tabId: TAB_ID, appSessionId: 'a', anchor, crop: 'attached' };
      expect(validateEventPayload('browser.comment.picked', picked).ok).toBe(true);
      expect(validateEventPayload('browser.comment.picked', { ...picked, anchor: { ...anchor, screenshot: { path: '/u/browser/crops/b.png', width: 2, height: 2 } } }).ok).toBe(true);
      for (const crop of ['none', 'tooLarge', 'failed']) expect(validateEventPayload('browser.comment.picked', { ...picked, crop }).ok, crop).toBe(true);
      expect(validateEventPayload('browser.comment.picked', { ...picked, crop: 'partial' }).ok).toBe(false);
      expect(validateEventPayload('browser.comment.picked', { ...picked, tabId: 'b_xyz' }).ok).toBe(false);
      for (const field of ['label', 'css', 'name', 'a11y'] as const)
        expect(validateEventPayload('browser.comment.picked', { ...picked, anchor: { ...anchor, [field]: 'a\u0000b' } }).ok, field).toBe(false);
      expect(validateEventPayload('browser.comment.picked', { ...picked, anchor: { ...anchor, html: '<b>' } }).ok).toBe(false);
    });
  });
  // E4d end
  // E4b start: the Chrome profile import's commands and events (E4b execution document, Interfaces "IPC `browser.import.*`")
  describe('E4b entries', () => {
    const profile = { profileDir: 'Default', name: 'Person 1', gaiaName: 'Probe Owner', userName: null, lastUsed: true, imported: false };
    const record = {
      profileDir: 'Default', name: 'Person 1', partition: 'persist:maws-chrome-Default', importedAt: '2026-10-06T10:00:05.000Z',
      storageDirName: 'maws-chrome-default', userDataDir: '/tmp/chrome', extensions: [PROBE_EXTENSION], report: DONE_REPORT,
      bookmarks: null, gaiaName: null, userName: null, avatar: { kind: 'initials' }, // cua #90: profiles.json version 2
    };
    const ID = '0b5f2c1e-8d4a-4f7b-9c3e-2a1d6e8f9b0c';
    const EXT = 'cddgipniephaglaopjjeihjehogcpggh';
    const importNames = (keys: string[]) => keys.filter((name) => name.startsWith('browser.import.'));

    it('appends browser.import.* after E4a’s entries, main-owned, every name bridged', () => {
      const added = importNames(Object.keys(browser.commands));
      expect(added).toEqual([
        'browser.import.profiles', 'browser.import.chooseUserData', 'browser.import.inspect', 'browser.import.discard', 'browser.import.start',
        'browser.import.cancel', 'browser.import.list', 'browser.import.remove', 'browser.import.setExtension',
      ]);
      expect(Object.keys(browser.commands).filter((name) => name !== 'browser.agent.activities.list' /* E13, appended after E4b */ && !name.startsWith('browser.bookmarks.') && !name.startsWith('browser.extensions.') /* cua #90 */ && name !== 'browser.view.capture' /* P3-G */).slice(-added.length)).toEqual(added); // nothing of E4a's reordered
      for (const name of added) expect(commands[name as keyof typeof commands].owner, name).toBe('main');
      const events = importNames(Object.keys(browser.events));
      expect(events).toEqual(['browser.import.progress', 'browser.import.finished', 'browser.import.changed']);
      expect(Object.keys(browser.events).filter((name) => name !== 'browser.agent.acting' /* E4c, appended after E4b */ && name !== 'browser.agent.activity' /* E13 */ && !name.startsWith('browser.bookmarks.') && !name.startsWith('browser.extensions.') /* cua #90 */).slice(-events.length)).toEqual(events);
      expect([...NAMES.browser.commands]).toEqual(Object.keys(browser.commands));
      expect([...NAMES.browser.events]).toEqual(Object.keys(browser.events));
    });

    it('refuses a relative Chrome folder, a profile directory that is a path, and a malformed extension id', () => {
      expect(validateCommandInput('browser.import.profiles', { userDataDir: null }).ok).toBe(true);
      expect(validateCommandInput('browser.import.profiles', { userDataDir: '/Users/x/Library/Application Support/Google/Chrome' }).ok).toBe(true);
      for (const userDataDir of ['Library/Chrome', '~/Library/Chrome', './Chrome', '', `/${'x'.repeat(1024)}`]) {
        expect(validateCommandInput('browser.import.profiles', { userDataDir }).ok, userDataDir).toBe(false);
        expect(validateCommandInput('browser.import.inspect', { userDataDir, profileDir: 'Default' }).ok, userDataDir).toBe(false);
      }
      expect(validateCommandInput('browser.import.inspect', { userDataDir: '/c', profileDir: 'Profile 1' }).ok).toBe(true);
      for (const profileDir of ['../Default', 'a/b', '', '.', '..', '.Default', 'Default\\x']) {
        expect(validateCommandInput('browser.import.inspect', { userDataDir: '/c', profileDir }).ok, profileDir).toBe(false);
        expect(validateCommandInput('browser.import.remove', { profileDir }).ok, profileDir).toBe(false);
        expect(validateCommandInput('browser.import.setExtension', { profileDir, extensionId: EXT, enabled: true }).ok, profileDir).toBe(false);
      }
      const start = { inspectionId: ID, categories: { history: true, cookies: true, extensions: true, bookmarks: true /* cua #90 */ }, extensionIds: [EXT], allowUnverifiedExtensions: true };
      expect(validateCommandInput('browser.import.start', start).ok).toBe(true);
      expect(validateCommandInput('browser.import.setExtension', { profileDir: 'Default', extensionId: EXT, enabled: false }).ok).toBe(true);
      for (const extensionId of ['probe', EXT.toUpperCase(), `${EXT}a`, '../ddgipniephaglaopjjeihjehogcpggh', 'zddgipniephaglaopjjeihjehogcpggh']) {
        expect(validateCommandInput('browser.import.start', { ...start, extensionIds: [extensionId] }).ok, extensionId).toBe(false);
        expect(validateCommandInput('browser.import.setExtension', { profileDir: 'Default', extensionId, enabled: true }).ok, extensionId).toBe(false);
      }
      expect(validateCommandInput('browser.import.start', { ...start, categories: { ...start.categories, passwords: true } }).ok).toBe(false);
      expect(validateCommandInput('browser.import.start', { ...start, inspectionId: '../x' }).ok).toBe(false);
      expect(validateCommandInput('browser.import.start', { ...start, profileDir: 'Default' }).ok).toBe(false);
    });

    it('validates the picker, the inspection and the run', () => {
      const listing = { userDataDir: '/c', found: true, chromeRunning: false, profiles: [profile], error: null };
      expect(validateCommandOutput('browser.import.profiles', listing).ok).toBe(true);
      expect(validateCommandOutput('browser.import.profiles', { ...listing, found: false, profiles: [], error: 'No Local State' }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.profiles', { ...listing, profiles: [{ ...profile, avatar: 'x' }] }).ok).toBe(false);
      expect(validateCommandInput('browser.import.chooseUserData', undefined).ok).toBe(true);
      expect(validateCommandOutput('browser.import.chooseUserData', { userDataDir: null }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.chooseUserData', { userDataDir: 'relative' }).ok).toBe(false);
      const candidate = {
        id: EXT, name: 'Probe', version: '1.0', manifestVersion: 3, background: 'service_worker', contentScripts: 1, unsupportedPermissions: ['cookies'],
        wallet: false, chromeState: 'enabled', sizeBytes: 10, error: null,
      };
      const inspection = { inspectionId: ID, profile, chromeRunning: true, history: { rows: 6 }, cookies: { rows: 5, partitioned: 1, storeVersion: 24 }, extensions: [candidate], bookmarks: { count: 46 } /* cua #90 */ };
      expect(validateCommandOutput('browser.import.inspect', inspection).ok).toBe(true);
      expect(validateCommandOutput('browser.import.inspect', { ...inspection, history: { error: 'History couldn’t be read' }, cookies: { error: 'Cookies couldn’t be read' } }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.inspect', { ...inspection, cookies: { rows: 5 } }).ok).toBe(false);
      expect(validateCommandOutput('browser.import.inspect', { ...inspection, history: { rows: 6, error: 'x' } }).ok).toBe(false);
      expect(validateCommandInput('browser.import.discard', { inspectionId: ID }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.start', { importId: ID }).ok).toBe(true);
      expect(validateCommandInput('browser.import.cancel', { importId: ID }).ok).toBe(true);
      expect(validateCommandInput('browser.import.cancel', { importId: 'i1' }).ok).toBe(false);
    });

    it('validates the records, the removal and the toggle', () => {
      expect(validateCommandInput('browser.import.list', undefined).ok).toBe(true);
      expect(validateCommandOutput('browser.import.list', { profiles: [record], fileBroken: false, running: null }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.list', { profiles: [], fileBroken: true, running: null }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.list', { profiles: [], fileBroken: false, running: { importId: ID, profileDir: 'Default', phase: 'keychain' } }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.list', { profiles: [], fileBroken: false, running: { importId: ID, profileDir: 'Default', phase: null } }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.list', { profiles: [], fileBroken: false, running: { importId: ID, profileDir: 'Default', phase: 'paused' } }).ok).toBe(false);
      expect(validateCommandOutput('browser.import.list', { profiles: [], fileBroken: false }).ok).toBe(false);
      expect(validateCommandOutput('browser.import.list', { profiles: [] }).ok).toBe(false);
      expect(validateCommandOutput('browser.import.list', { profiles: [{ ...record, partition: 'persist:maws-browser' }], fileBroken: false, running: null }).ok).toBe(false);
      expect(validateCommandInput('browser.import.remove', { profileDir: 'Profile 1' }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.remove', { removed: { tabs: 1, historyRows: 4, extensions: 3 } }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.remove', { removed: { tabs: -1, historyRows: 4, extensions: 3 } }).ok).toBe(false);
      expect(validateCommandOutput('browser.import.setExtension', { extension: PROBE_EXTENSION }).ok).toBe(true);
      expect(validateCommandOutput('browser.import.setExtension', { extension: { ...PROBE_EXTENSION, path: '/x' } }).ok).toBe(false);
    });

    it('validates the events, and leaves browser.notice’s kinds as E4a landed them (Decision Log 35)', () => {
      expect(validateEventPayload('browser.import.progress', { importId: ID, phase: 'cookies', done: 200, total: 5112 }).ok).toBe(true);
      expect(validateEventPayload('browser.import.progress', { importId: ID, phase: 'passwords', done: 0, total: 1 }).ok).toBe(false);
      expect(validateEventPayload('browser.import.finished', { importId: ID, report: DONE_REPORT }).ok).toBe(true);
      expect(validateEventPayload('browser.import.finished', { importId: ID, report: { ...DONE_REPORT, outcome: 'partial' } }).ok).toBe(false);
      expect(validateEventPayload('browser.import.changed', { profiles: [record] }).ok).toBe(true);
      expect(validateEventPayload('browser.import.changed', { profiles: [record], fileBroken: false }).ok).toBe(false);
      expect(validateEventPayload('browser.notice', { appSessionId: 'a', tabId: null, kind: 'profilesFileBroken' }).ok).toBe(false);
    });
  });
  // E4b end
  // cua #90 start: an imported profile's bookmarks (cua board #90's spec, Interfaces "IPC")
  describe('cua #90 entries', () => {
    const tree = {
      bar: { kind: 'folder', id: 1, name: 'Bookmarks bar', children: [{ kind: 'url', id: 2, name: 'A', url: 'https://a.example/', addedAt: 1 }, { kind: 'folder', id: 3, name: 'F', children: [] }] },
      other: { kind: 'folder', id: 4, name: 'Other bookmarks', children: [] },
      mobile: { kind: 'folder', id: 5, name: 'Mobile bookmarks', children: [] },
    };

    it('appends browser.bookmarks.tree, .sync and .changed after E13’s entries, main-owned, every name bridged', () => {
      expect(Object.keys(browser.commands).filter((name) => name !== 'browser.view.capture' /* P3-G, appended last */).slice(-10, -5)).toEqual(['browser.bookmarks.tree', 'browser.bookmarks.sync', 'browser.bookmarks.open', 'browser.bookmarks.menu', 'browser.bookmarks.favicons']); // M1b: the bar's three
      expect(Object.keys(browser.events).slice(-4, -3)).toEqual(['browser.bookmarks.changed']);
      for (const name of ['browser.bookmarks.tree', 'browser.bookmarks.sync', 'browser.bookmarks.open', 'browser.bookmarks.menu', 'browser.bookmarks.favicons'] as const) expect(commands[name].owner).toBe('main');
      expect([...NAMES.browser.commands]).toEqual(Object.keys(browser.commands));
      expect([...NAMES.browser.events]).toEqual(Object.keys(browser.events));
    });

    it('validates the tree: three folder roots, only http(s) URLs, no extra key', () => {
      expect(validateCommandInput('browser.bookmarks.tree', { partition: 'persist:maws-chrome-Default' }).ok).toBe(true);
      expect(validateCommandInput('browser.bookmarks.tree', { partition: 'persist:maws-capture' }).ok).toBe(false);
      expect(validateCommandOutput('browser.bookmarks.tree', { tree }).ok).toBe(true);
      const withUrl = (url: string) => ({ tree: { ...tree, bar: { ...tree.bar, children: [{ kind: 'url', id: 2, name: 'A', url, addedAt: null }] } } });
      for (const url of ['javascript:alert(1)', 'file:///etc/hosts', 'chrome://settings/', 'https://a b/']) expect(validateCommandOutput('browser.bookmarks.tree', withUrl(url)).ok, url).toBe(false);
      expect(validateCommandOutput('browser.bookmarks.tree', { tree: { ...tree, bar: { ...tree.bar, extra: 1 } } }).ok).toBe(false);
      expect(validateCommandOutput('browser.bookmarks.tree', { tree: { bar: tree.bar, other: tree.other } }).ok).toBe(false);
    });

    it('validates the sync, the suggestion’s kind, the inspection’s count, the new phase and category, and the event', () => {
      expect(validateCommandInput('browser.bookmarks.sync', { profileDir: 'Default' }).ok).toBe(true);
      expect(validateCommandInput('browser.bookmarks.sync', { profileDir: '../Default' }).ok).toBe(false);
      expect(validateCommandOutput('browser.bookmarks.sync', { syncedAt: '2026-10-08T12:00:00.000Z', count: 46 }).ok).toBe(true);
      for (const error of ['missing', 'unreadable', 'indexUnavailable', 'refused']) expect(validateCommandOutput('browser.bookmarks.sync', { error }).ok, error).toBe(true);
      expect(validateCommandOutput('browser.bookmarks.sync', { error: 'refused', reason: 'an import is running' }).ok).toBe(true);
      expect(validateCommandOutput('browser.history.suggest', { suggestions: [{ url: 'https://a.b/', title: 'A', kind: 'bookmark' }] }).ok).toBe(true);
      expect(validateCommandOutput('browser.history.suggest', { suggestions: [{ url: 'https://a.b/', title: 'A', kind: 'folder' }] }).ok).toBe(false);
      expect(validateEventPayload('browser.import.progress', { importId: '0b5f2c1e-8d4a-4f7b-9c3e-2a1d6e8f9b0c', phase: 'bookmarks', done: 0, total: 1 }).ok).toBe(true);
      expect(validateEventPayload('browser.bookmarks.changed', { partition: 'persist:maws-chrome-Default' }).ok).toBe(true);
      expect(validateEventPayload('browser.bookmarks.changed', { partition: 'persist:maws-chrome-Default', tree }).ok).toBe(false);
    });

    // M1b: the bar's commands name their tab; a node id is an index row's (from 1); ⇧⌘B reaches the chrome
    it('validates the bar\'s open, menu and favicons, and the chrome\'s toggleBookmarksBar', () => {
      const tabId = 'b_000000000001';
      expect(validateCommandInput('browser.bookmarks.open', { tabId, nodeId: 4, how: 'current' }).ok).toBe(true);
      expect(validateCommandInput('browser.bookmarks.open', { tabId, nodeId: 4, how: 'newTab' }).ok).toBe(true);
      for (const bad of [{ tabId, nodeId: 0, how: 'current' }, { tabId, nodeId: 1.5, how: 'current' }, { tabId, nodeId: 4, how: 'window' }, { nodeId: 4, how: 'current' }, { tabId, nodeId: 4, how: 'current', url: 'https://a.b/' }]) {
        expect(validateCommandInput('browser.bookmarks.open', bad).ok, JSON.stringify(bad)).toBe(false);
      }
      expect(validateCommandInput('browser.bookmarks.menu', { tabId, request: { kind: 'folder', nodeId: 4 }, anchor: { x: 10, y: 64 } }).ok).toBe(true);
      expect(validateCommandInput('browser.bookmarks.menu', { tabId, request: { kind: 'overflow', hiddenFrom: 0 }, anchor: { x: 0, y: 0 } }).ok).toBe(true);
      expect(validateCommandInput('browser.bookmarks.menu', { tabId, request: { kind: 'overflow', hiddenFrom: -1 }, anchor: { x: 0, y: 0 } }).ok).toBe(false);
      expect(validateCommandInput('browser.bookmarks.menu', { tabId, request: { kind: 'folder', hiddenFrom: 3 }, anchor: { x: 0, y: 0 } }).ok).toBe(false);
      expect(validateCommandInput('browser.bookmarks.menu', { tabId, request: { kind: 'overflow', hiddenFrom: 3 }, anchor: { x: 0.5, y: 0 } }).ok).toBe(false);
      expect(validateCommandInput('browser.bookmarks.favicons', { partition: 'persist:maws-chrome-Default', origins: ['https://a.b'] }).ok).toBe(true);
      expect(validateCommandInput('browser.bookmarks.favicons', { partition: 'persist:maws-chrome-Default', origins: Array.from({ length: 501 }, () => 'https://a.b') }).ok).toBe(false);
      expect(validateCommandOutput('browser.bookmarks.favicons', { icons: { 'https://a.b': 'data:image/png;base64,QQ==' } }).ok).toBe(true);
      expect(validateEventPayload('browser.chrome.command', { tabId, command: 'toggleBookmarksBar' }).ok).toBe(true);
    });

    // M3: the extensions action bar
    it('appends browser.extensions.* after the bookmarks, main-owned, every name bridged', () => {
      const names = ['browser.extensions.actions', 'browser.extensions.action.click', 'browser.extensions.action.options', 'browser.extensions.action.menu', 'browser.extensions.puzzle'] as const;
      expect(Object.keys(browser.commands).filter((name) => name !== 'browser.view.capture' /* P3-G, appended last */).slice(-5)).toEqual([...names]);
      expect(Object.keys(browser.commands).at(-1)).toBe('browser.view.capture'); // P3-G
      expect(Object.keys(browser.events).slice(-3)).toEqual(['browser.extensions.actions.changed', 'browser.extensions.popup', 'browser.extensions.reveal']);
      for (const name of names) expect(commands[name].owner).toBe('main');
    });

    it('validates the actions, the tab-scoped commands, the events and the notices', () => {
      const tabId = 'b_000000000001';
      const extensionId = 'nenbjdahllkkbfanbpfmmdacjencdfpg';
      const action = { extensionId, name: 'MAWS probe extension', title: 'MAWS probe', icon: null, hasPopup: true, hasOptions: true };
      const anchor = { x: 600, y: 36, width: 24, height: 24 };
      expect(validateCommandOutput('browser.extensions.actions', { actions: [action, { ...action, icon: 'data:image/png;base64,QQ==' }] }).ok).toBe(true);
      for (const bad of [{ ...action, icon: 'https://x.test/icon.png' }, { ...action, extensionId: 'x' }, { ...action, popupUrl: 'chrome-extension://x/' }]) {
        expect(validateCommandOutput('browser.extensions.actions', { actions: [bad] }).ok, JSON.stringify(bad)).toBe(false);
      }
      expect(validateCommandInput('browser.extensions.action.click', { tabId, extensionId, anchor }).ok).toBe(true);
      expect(validateCommandInput('browser.extensions.action.click', { tabId, extensionId, anchor: { ...anchor, x: 0.5 } }).ok).toBe(false);
      expect(validateCommandInput('browser.extensions.action.click', { extensionId, anchor }).ok).toBe(false);
      expect(validateCommandInput('browser.extensions.action.options', { tabId, extensionId }).ok).toBe(true);
      expect(validateCommandInput('browser.extensions.action.options', { tabId, extensionId, url: `chrome-extension://${extensionId}/options.html` }).ok).toBe(false);
      expect(validateCommandInput('browser.extensions.action.menu', { tabId, extensionId, anchor: { x: 1, y: 2 } }).ok).toBe(true);
      expect(validateCommandInput('browser.extensions.puzzle', { tabId, anchor }).ok).toBe(true);
      expect(validateEventPayload('browser.extensions.actions.changed', { partition: 'persist:maws-chrome-Default' }).ok).toBe(true);
      expect(validateEventPayload('browser.extensions.popup', { tabId, extensionId: null }).ok).toBe(true);
      expect(validateEventPayload('browser.extensions.reveal', { tabId, show: { kind: 'settings' } }).ok).toBe(true);
      expect(validateEventPayload('browser.extensions.reveal', { tabId, show: { kind: 'tab', tab: {} } }).ok).toBe(false);
      for (const kind of ['extensionPopupFailed', 'extensionPageClosed']) expect(validateEventPayload('browser.notice', { appSessionId: 'a', tabId: null, kind, name: 'MAWS probe' }).ok, kind).toBe(true);
    });
  });
  // cua #90 end
  // E4c start: what stays of E4c's IPC once the browser tools left the `maws` server (P1 A-54): no `maws.browser.*` bridge;
  // `browser.agent.acting`, restored for cua's leases (A-54, amended); E13's download record and agent activity
  describe('E4c entries', () => {
    const TAB_ID = 'b_000000000001';

    it('the browser tools\' bridge left with the tools', () => {
      expect(Object.keys(commands).filter((name) => name.startsWith('maws.browser.'))).toEqual([]);
      expect(Object.keys(events).filter((name) => name.startsWith('maws.browser.'))).toEqual([]);
      expect([...NAMES.maws.commands]).toEqual(Object.keys(maws.commands));
      expect([...NAMES.maws.events]).toEqual(Object.keys(maws.events));
      expect([...NAMES.browser.events]).toEqual(Object.keys(browser.events));
    });

    it('validates the acting tab: its owner, the tab and the session acting (E4c\'s event, restored for cua\'s leases)', () => {
      const acting = { appSessionId: 'a', tabId: TAB_ID, actingSessionId: 'thread' };
      expect(validateEventPayload('browser.agent.acting', acting).ok).toBe(true);
      expect(validateEventPayload('browser.agent.acting', { ...acting, tabId: 'nope' }).ok).toBe(false);
      expect(validateEventPayload('browser.agent.acting', { appSessionId: 'a', tabId: TAB_ID }).ok).toBe(false); // who acts is named
    });

    it('E13: validates an agent\'s finished download through cua', () => {
      const download = { appSessionId: 'a', tabId: TAB_ID, path: '/Users/x/Downloads/r.pdf', filename: 'r.pdf', url: 'http://127.0.0.1:1/r.pdf', bytes: 10 };
      expect(commands['maws.download.recorded'].owner).toBe('engine-host');
      expect(validateCommandInput('maws.download.recorded', download).ok).toBe(true);
      expect(validateCommandInput('maws.download.recorded', { ...download, path: 'r.pdf' }).ok).toBe(false);
      expect(validateCommandInput('maws.download.recorded', { ...download, bytes: -1 }).ok).toBe(false);
      for (const outcome of ['recorded', 'duplicate', 'not_held']) expect(validateCommandOutput('maws.download.recorded', { outcome }).ok).toBe(true);
    });

    it('E13: validates an agent\'s activity through cua: one of the listed kinds, typed text as a count only', () => {
      const at = '2026-10-08T00:00:00.000Z';
      const ok = (activity: unknown) => validateEventPayload('browser.agent.activity', { appSessionId: 'a', tabId: TAB_ID, at, activity }).ok;
      for (const activity of [
        { kind: 'navigated', url: 'https://example.com/', title: '' },
        { kind: 'clicked', x: 10, y: 20.5, label: 'button Submit' },
        { kind: 'clicked', x: 0, y: 0, label: null },
        { kind: 'typed', chars: 12 },
        { kind: 'key', key: 'Enter' },
        { kind: 'screenshot' },
        { kind: 'download', filename: 'cua-report.pdf', state: 'complete' },
        { kind: 'dialog', type: 'confirm', excerpt: 'Leave?', answered: 'default' },
        { kind: 'tabOpened', url: 'about:blank' },
        { kind: 'tabClosed', url: 'https://example.com/' },
      ]) expect(ok(activity), JSON.stringify(activity)).toBe(true);
      expect(ok({ kind: 'typed', chars: 3, text: 'abc' })).toBe(false); // the text itself never travels
      expect(ok({ kind: 'typed', chars: 0 })).toBe(false);
      expect(ok({ kind: 'clicked', x: 1, y: 1, label: 'x'.repeat(41) })).toBe(false);
      expect(ok({ kind: 'dialog', type: 'prompt', excerpt: '', answered: 'accepted' })).toBe(false);
      expect(ok({ kind: 'moved', x: 1, y: 1 })).toBe(false);
      expect(validateEventPayload('browser.agent.activity', { appSessionId: 'a', tabId: 'nope', at, activity: { kind: 'screenshot' } }).ok).toBe(false);
      // the session's kept activity, listed when a transcript mounts
      const kept = { appSessionId: 'a', tabId: TAB_ID, at, activity: { kind: 'screenshot' } };
      expect(validateCommandInput('browser.agent.activities.list', { appSessionId: 'a' }).ok).toBe(true);
      expect(validateCommandOutput('browser.agent.activities.list', { activities: [kept] }).ok).toBe(true);
      expect(validateCommandOutput('browser.agent.activities.list', { activities: Array(501).fill(kept) }).ok).toBe(false);
    });

    it('adds the notice for a page dialog MAWS answered on a tab nobody had placed (A-42): its type and a short plain excerpt', () => {
      const notice = { appSessionId: 'a', tabId: TAB_ID, kind: 'dialogAnswered', dialogType: 'confirm', excerpt: 'Leave this page?' };
      expect(validateEventPayload('browser.notice', notice).ok).toBe(true);
      expect(validateEventPayload('browser.notice', { ...notice, dialogType: 'alert', excerpt: '' }).ok).toBe(true);
      expect(validateEventPayload('browser.notice', { ...notice, dialogType: 'prompt' }).ok).toBe(false);
      expect(validateEventPayload('browser.notice', { ...notice, excerpt: 'x'.repeat(201) }).ok).toBe(false);
    });
  });
  // E4c end
  // P2-C start (2026-10-09): the built-in mods (X20; the P2-C document, §9) and the binary's flag declaration
  describe('P2-C entries', () => {
    const row = { id: 'maws.to-human', name: 'To-human', description: 'd', version: 1, enabled: true, source: 'maws-contract' };
    it('adds the mods namespace: two main commands, no event', () => {
      expect(Object.fromEntries(Object.entries(mods.commands).map(([name, spec]) => [name, spec.owner]))).toEqual({ 'mods.list': 'main', 'mods.setSessionOverride': 'main' });
      expect([...NAMES.mods.commands]).toEqual(Object.keys(mods.commands));
      expect(Object.keys(mods.events)).toEqual([]);
    });

    it('lists the mods with or without a session, and answers rows of the registry’s shape', () => {
      expect(validateCommandInput('mods.list', {}).ok).toBe(true);
      expect(validateCommandInput('mods.list', { appSessionId: 'a' }).ok).toBe(true);
      expect(validateCommandInput('mods.list', { appSessionId: 'a', all: true }).ok).toBe(false);
      expect(validateCommandOutput('mods.list', [row, { ...row, perSession: 'off', pending: 'next-compaction', mismatch: { resolved: 'report', observed: 'default' } }]).ok).toBe(true);
      expect(validateCommandOutput('mods.list', [{ ...row, source: 'style' }]).ok).toBe(false);
      expect(validateCommandOutput('mods.list', [{ ...row, id: 'maws.other' }]).ok).toBe(false);
    });

    it('sets a session’s override of a known mod to inherit, on or off', () => {
      for (const value of ['inherit', 'on', 'off']) expect(validateCommandInput('mods.setSessionOverride', { appSessionId: 'a', id: 'maws.to-human', value }).ok).toBe(true);
      expect(validateCommandInput('mods.setSessionOverride', { appSessionId: 'a', id: 'maws.to-human', value: 'default' }).ok).toBe(false);
      expect(validateCommandInput('mods.setSessionOverride', { appSessionId: 'a', id: 'other', value: 'on' }).ok).toBe(false);
      expect(validateCommandInput('mods.setSessionOverride', { id: 'maws.to-human', value: 'on' }).ok).toBe(false);
    });

    it('engine.binaryInfo answers whether the binary declares --system-prompt-snapshot, absent from an older host', () => {
      const info = { path: '/b', testedVersion: '2.1.293', version: '2.1.295', ok: true, error: null };
      expect(validateCommandOutput('engine.binaryInfo', { ...info, declaresSystemPromptSnapshot: true }).ok).toBe(true);
      expect(validateCommandOutput('engine.binaryInfo', info).ok).toBe(true);
      expect(validateCommandOutput('engine.binaryInfo', { ...info, declaresSystemPromptSnapshot: 'yes' }).ok).toBe(false);
    });

    // M4 (2026-10-09): main's owner channel
    it('adds the ownerChannel namespace: four main commands and its changed event', () => {
      expect(Object.fromEntries(Object.entries(ownerChannel.commands).map(([name, spec]) => [name, spec.owner]))).toEqual({
        'ownerChannel.state': 'main', 'ownerChannel.answered': 'main', 'ownerChannel.cancel': 'main', 'ownerChannel.markRead': 'main',
      });
      expect([...NAMES.ownerChannel.commands]).toEqual(Object.keys(ownerChannel.commands));
      expect([...NAMES.ownerChannel.events]).toEqual(Object.keys(ownerChannel.events));
      expect(HOST_EVENTS as readonly string[]).not.toContain('ownerChannel.changed'); // main's own, never across the host wire
    });

    it('takes the seam’s result per disposition, and refuses an unknown one or an origin the card does not send', () => {
      const report = { appSessionId: 'a', markId: 'a:m1:0:q0', text: 'Answering "Which backend?": Postgres', origin: 'answer' };
      expect(validateCommandInput('ownerChannel.answered', { ...report, disposition: 'sent', started: false, messageUuid: '11111111-1111-4111-8111-111111111111' }).ok).toBe(true);
      expect(validateCommandInput('ownerChannel.answered', { ...report, disposition: 'queued', started: true, queueId: 'q-1' }).ok).toBe(true);
      expect(validateCommandInput('ownerChannel.answered', { ...report, origin: 'reply', disposition: 'steered', started: false, messageUuid: '11111111-1111-4111-8111-111111111111' }).ok).toBe(true);
      expect(validateCommandInput('ownerChannel.answered', { ...report, disposition: 'refused', started: false, reason: 'Session ended' }).ok).toBe(true);
      // X22's final shape (P2-A): `started` is a field, never a disposition; all five dispositions mirrored, `held` included
      expect(validateCommandInput('ownerChannel.answered', { ...report, origin: 'reply', disposition: 'started', started: true }).ok).toBe(false);
      expect(validateCommandInput('ownerChannel.answered', { ...report, disposition: 'held', started: false, reason: 'trust' }).ok).toBe(true);
      // the seam's call time, for a report main's late-report log no longer covers
      expect(validateCommandInput('ownerChannel.answered', { ...report, disposition: 'queued', started: false, queueId: 'q-1', sentAt: '2026-10-09T10:00:00.000Z' }).ok).toBe(true);
      expect(validateCommandInput('ownerChannel.answered', { ...report, disposition: 'queued', started: false, queueId: 'q-1', sentAt: 'yesterday' }).ok).toBe(false);
      expect(validateCommandInput('ownerChannel.answered', { ...report, disposition: 'sent', messageUuid: '11111111-1111-4111-8111-111111111111' }).ok).toBe(false);
      expect(validateCommandInput('ownerChannel.answered', { ...report, disposition: 'delivered', started: false }).ok).toBe(false);
      expect(validateCommandInput('ownerChannel.answered', { ...report, origin: 'legacy', disposition: 'sent', started: false }).ok).toBe(false);
      expect(validateCommandInput('ownerChannel.markRead', { appSessionId: 'a', markIds: 'all' }).ok).toBe(true);
      expect(validateCommandInput('ownerChannel.markRead', { appSessionId: 'a', markIds: ['a:m1:0:e0'] }).ok).toBe(true);
      expect(validateCommandInput('ownerChannel.markRead', { appSessionId: 'a', markIds: 'some' }).ok).toBe(false);
      expect(validateCommandOutput('ownerChannel.cancel', { outcome: 'already_delivering' }).ok).toBe(true);
      expect(validateCommandOutput('ownerChannel.cancel', { outcome: 'already_started' }).ok).toBe(false);
    });

    it('states a session’s lane and marks, a question with its members, an essential with its read time', () => {
      const anchor = { messageUuid: '11111111-1111-4111-8111-111111111111', blockIndex: 0, span: 0 };
      const state = {
        appSessionId: 'a', lane: { on: true, override: 'inherit', applied: 'maws-contract', pending: null, mismatch: null },
        marks: [
          { id: 'a:m:0:q0', kind: 'need-input', anchor, head: 'Which backend?', at: '2026-10-09T10:00:00.000Z', item: true, question: { state: 'queued', text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [{ kind: 'entry', id: 'q-1', life: 'alive' }] } },
          { id: 'a:m:0:e0', kind: 'essential', anchor, head: 'Rotate the key', at: '2026-10-09T10:00:00.000Z', item: true, essential: { state: 'read', readAt: '2026-10-09T10:05:00.000Z' } },
          { id: 'a:m:0:q1', kind: 'need-input', anchor: { ...anchor, span: 1 }, head: 'Which port?', at: '2026-10-09T10:00:00.000Z', item: true, question: { state: 'unanswered', held: { reason: 'trust' } } },
        ],
      };
      expect(validateEventPayload('ownerChannel.changed', { appSessionId: 'a', state }).ok).toBe(true);
      expect(validateCommandOutput('ownerChannel.state', state).ok).toBe(true);
      expect(validateEventPayload('attention.changed', { appSessionId: 'a', items: [] }).ok).toBe(true);
    });
  });
  // P2-C end

  // P3-A start (M4): the artifact store's surface (docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4)
  describe('P3-A entries', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const human = { kind: 'human' };
    const artifact = { id, kind: 'document', title: 'Plan', createdBy: human, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 0 };

    it('owns artifacts.* in the engine host but artifacts.open (main), keeps setDefaults and content main-only, and emits both events across the host wire', () => {
      const owners = Object.fromEntries(Object.entries({ ...artifacts.commands, ...spaces.commands }).map(([name, spec]) => [name, spec.owner]));
      expect(Object.entries(owners).filter(([, owner]) => owner !== 'engine-host').map(([name]) => name)).toEqual(['artifacts.open']);
      expect(MAIN_ONLY_COMMANDS).toEqual(expect.arrayContaining(['artifacts.setDefaults', 'artifacts.content']));
      expect([...NAMES.artifacts.commands]).not.toContain('artifacts.setDefaults');
      expect([...NAMES.artifacts.commands]).not.toContain('artifacts.content');
      expect(HOST_EVENTS).toEqual(expect.arrayContaining(['artifacts.changed', 'spaces.changed']));
      expect(Object.keys(spaces.commands)).toEqual(['spaces.list', 'spaces.create', 'spaces.update', 'spaces.delete']);
    });

    it('answers artifacts with their revision and the agent-suggestions flag, and refuses a row without either', () => {
      expect(validateCommandOutput('artifacts.get', { artifact }).ok).toBe(true);
      expect(validateCommandOutput('artifacts.get', { artifact: null }).ok).toBe(true);
      for (const key of ['revision', 'agentEditsAsSuggestions'] as const) {
        const without: Record<string, unknown> = { ...artifact };
        delete without[key];
        expect(validateCommandOutput('artifacts.list', { artifacts: [without] }).ok, key).toBe(false);
      }
    });

    it('takes a byte kind’s content as bytes or a path, never both shapes at once', () => {
      expect(validateCommandInput('artifacts.create', { kind: 'html', title: 'Page', content: { bytes: new Uint8Array([60]), name: 'index.html' } }).ok).toBe(true);
      expect(validateCommandInput('artifacts.create', { kind: 'file', title: 'Report', content: { path: '/tmp/report.pdf' } }).ok).toBe(true);
      expect(validateCommandInput('artifacts.create', { kind: 'html', title: 'Page', content: { bytes: [60] } }).ok).toBe(false);
      expect(validateCommandInput('artifacts.create', { kind: 'html', title: 'Page', content: { bytes: new Uint8Array([60]), path: '/tmp/x' } }).ok).toBe(false);
      expect(validateCommandInput('artifacts.create', { kind: 'document', title: '' }).ok).toBe(false);
    });

    it('names a version state by exactly one of its id and its seq', () => {
      expect(validateCommandInput('artifacts.versionState', { artifactId: id, versionId: 3 }).ok).toBe(true);
      expect(validateCommandInput('artifacts.versionState', { artifactId: id, seq: 0 }).ok).toBe(true);
      expect(validateCommandInput('artifacts.versionState', { artifactId: id }).ok).toBe(false);
      expect(validateCommandInput('artifacts.versionState', { artifactId: id, versionId: 3, seq: 4 }).ok).toBe(false);
      expect(validateCommandOutput('artifacts.versionState', { bytes: new Uint8Array(4) }).ok).toBe(true);
    });

    it('caps an uploaded asset at 16 MiB and takes the test writer’s three operations only', () => {
      expect(validateCommandInput('artifacts.uploadAsset', { artifactId: id, name: 'logo.png', mime: 'image/png', bytes: new Uint8Array(16 * 1024 * 1024 + 1) }).ok).toBe(false);
      expect(validateCommandInput('artifacts.uploadAsset', { artifactId: id, name: 'logo.png', mime: 'image/png', bytes: new Uint8Array(8) }).ok).toBe(true);
      const ops = [{ op: 'setAttr', key: 'title', value: { nested: [1, 'two'] } }, { op: 'insertText', index: 0, text: 'hi', root: 'body' }, { op: 'deleteText', index: 0, length: 1 }];
      expect(validateCommandInput('artifacts.testWrite', { artifactId: id, opId: 'op-1', ops, appSessionId: 'sess-1' }).ok).toBe(true);
      expect(validateCommandInput('artifacts.testWrite', { artifactId: id, opId: 'op-1', ops: [{ op: 'format', index: 0 }] }).ok).toBe(false);
      expect(validateCommandInput('artifacts.testWrite', { artifactId: id, opId: 'op-1', ops: [] }).ok).toBe(false);
    });

    it('carries the change feed’s four artifact changes and three Space changes', () => {
      for (const change of ['created', 'updated', 'deleted', 'linked']) expect(validateEventPayload('artifacts.changed', { artifactId: id, kind: 'html', revision: 3, change }).ok).toBe(true);
      expect(validateEventPayload('artifacts.changed', { artifactId: id, kind: 'html', revision: 3, change: 'resync' }).ok).toBe(false);
      for (const change of ['created', 'updated', 'deleted']) expect(validateEventPayload('spaces.changed', { spaceId: id, change }).ok).toBe(true);
      expect(validateEventPayload('spaces.changed', { spaceId: id, change: 'linked' }).ok).toBe(false);
    });

    // P3-A M5: main's one hook for a reconcile read after events the renderer may have missed (Decision Log in M5)
    it('announces a resync from main, outside the host wire, with nothing in it', () => {
      expect(validateEventPayload('artifacts.resync', {}).ok).toBe(true);
      expect(validateEventPayload('artifacts.resync', { artifactId: id }).ok).toBe(false);
      expect([...NAMES.artifacts.events]).toContain('artifacts.resync');
      expect(HOST_EVENTS).not.toContain('artifacts.resync');
    });

    // P3-A M5: a setAttr value is a JSON value, never `undefined`, so the detached JSON line cannot drop it
    it('takes a JSON value for the test writer’s setAttr, and no undefined', () => {
      for (const value of ['s', 1, true, null, [1, { a: 2 }], { nested: { deep: [null] } }]) {
        expect(validateCommandInput('artifacts.testWrite', { artifactId: id, opId: 'op', ops: [{ op: 'setAttr', key: 'k', value }] }).ok, JSON.stringify(value)).toBe(true);
      }
      expect(validateCommandInput('artifacts.testWrite', { artifactId: id, opId: 'op', ops: [{ op: 'setAttr', key: 'k', value: undefined }] }).ok).toBe(false);
      expect(validateCommandInput('artifacts.testWrite', { artifactId: id, opId: 'op', ops: [{ op: 'setAttr', key: 'k' }] }).ok).toBe(false);
    });

    // The value is checked all the way down: what JSON would drop or rewrite (undefined to null or nothing, NaN and
    // Infinity to null) is refused at any depth, since the detached line would carry something else than was sent.
    it('refuses a non-JSON value at any depth in a setAttr value', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const nonJson: [string, unknown][] = [
        ['undefined in an array', [undefined]],
        ['undefined in a record', { nested: undefined }],
        ['undefined at depth', { a: [{ b: [1, { c: undefined }] }] }],
        ['a function', { f: () => 1 }],
        ['a function at depth', [[{ f: () => 1 }]]],
        ['NaN', [Number.NaN]],
        ['Infinity at depth', { a: { b: [Number.POSITIVE_INFINITY] } }],
        ['-Infinity', { a: Number.NEGATIVE_INFINITY }],
        ['a bigint', [1n]],
        ['a symbol', { s: Symbol('x') }],
        ['a Date', { d: new Date(0) }],
        ['a Map', { m: new Map() }],
        ['a typed array', { b: new Uint8Array(2) }],
        ['a sparse array', [1, , 3]], // eslint-disable-line no-sparse-arrays
        ['a cycle', cyclic],
      ];
      for (const [label, value] of nonJson) {
        expect(validateCommandInput('artifacts.testWrite', { artifactId: id, opId: 'op', ops: [{ op: 'setAttr', key: 'k', value }] }).ok, label).toBe(false);
      }
      for (const value of [[], {}, [[], {}], { a: { b: [0, -0, 1.5, 'x', true, null] } }]) {
        expect(validateCommandInput('artifacts.testWrite', { artifactId: id, opId: 'op', ops: [{ op: 'setAttr', key: 'k', value }] }).ok, JSON.stringify(value)).toBe(true);
      }
    });

    it('reads a store refusal back out of an IpcError, and nothing out of any other error', () => {
      const refusal = { reason: 'designSystemInUse', data: { artifactIds: [id] } };
      expect(artifactRefusalOf({ code: 'invalid_input', message: 'in use', issues: refusal })).toEqual(refusal);
      expect(artifactRefusalOf({ code: 'timeout', message: 'slow' })).toBeNull();
      expect(artifactRefusalOf({ code: 'invalid_input', message: 'bad', issues: [{ path: ['x'] }] })).toBeNull();
    });
  });
  // P3-A end

  // P3-L start (M1): the library's reads (docs/doperpowers/plans/2026-10-12-p3-l-library.md, Decision Log 2 and 9)
  describe('P3-L entries', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const entry = { id, kind: 'html', title: 'Page', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 3, lastEditor: { kind: 'session', appSessionId: 'sess-1' }, lastEditedAt: 2 };
    const row = { ...entry, lastEditorTitle: 'Make a page', sessions: [{ appSessionId: 'sess-1', title: 'Make a page', roles: ['created', 'edited'], lastAt: 2 }], space: { id, name: 'Work' }, snippet: 'the page' };
    const counts = { document: 0, presentation: 0, design: 0, design_system: 0, dashboard: 0, html: 1, file: 0 };

    it('owns the three reads in main and the three host reads in the engine host, main-only, and emits library.changed from main', () => {
      const owners = Object.fromEntries(Object.entries(library.commands).map(([name, spec]) => [name, spec.owner]));
      expect(owners).toEqual({ 'library.list': 'main', 'library.get': 'main', 'library.spaces': 'main', 'library.snapshot': 'engine-host', 'library.entry': 'engine-host', 'library.text': 'engine-host' });
      expect(MAIN_ONLY_COMMANDS).toEqual(expect.arrayContaining(['library.snapshot', 'library.entry', 'library.text']));
      expect([...NAMES.library.commands]).toEqual(['library.list', 'library.get', 'library.spaces']);
      expect(HOST_EVENTS).not.toContain('library.changed');
    });

    it('answers rows with the entry, its sessions, Space, project and snippet, and every kind counted', () => {
      expect(validateCommandOutput('library.list', { rows: [row], counts }).ok).toBe(true);
      expect(validateCommandOutput('library.get', { row: null }).ok).toBe(true);
      expect(validateCommandOutput('library.get', { row: { ...row, lastEditor: { kind: 'human' }, lastEditorTitle: undefined } }).ok).toBe(true);
      expect(validateCommandOutput('library.snapshot', { artifacts: [{ ...entry, lastEditorTitle: 'x' }], links: [], spaces: [] }).ok, 'the title is main\'s, never the host\'s').toBe(false);
      const missing: Record<string, number> = { ...counts };
      delete missing.html;
      expect(validateCommandOutput('library.list', { rows: [], counts: missing }).ok).toBe(false);
      const noEditor: Record<string, unknown> = { ...entry };
      delete noEditor.lastEditor;
      expect(validateCommandOutput('library.snapshot', { artifacts: [noEditor], links: [], spaces: [] }).ok).toBe(false);
      expect(validateCommandOutput('library.snapshot', { artifacts: [entry], links: [{ artifactId: id, appSessionId: 'sess-1', role: 'created', lastAt: 1 }], spaces: [] }).ok).toBe(true);
      expect(validateCommandOutput('library.entry', { artifact: null, links: [] }).ok).toBe(true);
      expect(validateCommandOutput('library.text', { revision: 3, text: 'hello' }).ok).toBe(true);
    });

    it('filters by a Space or by none, and caps the query', () => {
      expect(validateCommandInput('library.list', { filter: { spaceId: null, lineage: true, appSessionId: 'sess-1', query: '회의' } }).ok).toBe(true);
      expect(validateCommandInput('library.list', { filter: { spaceId: 'not-a-uuid' } }).ok).toBe(false);
      expect(validateCommandInput('library.list', { filter: { projectId: 'project-1', spaceId: null } }).ok).toBe(true); // §4.1: filterable, never a Space
      expect(validateCommandInput('library.list', { filter: { projectId: 42 } }).ok).toBe(false);
      expect(validateCommandInput('library.list', { filter: { query: 'x'.repeat(1_001) } }).ok).toBe(false);
      expect(validateCommandInput('library.list', { filter: { kind: 'slides' } }).ok).toBe(false);
      expect(validateEventPayload('library.changed', { revision: 4 }).ok).toBe(true);
    });
  });
  // P3-L end
});

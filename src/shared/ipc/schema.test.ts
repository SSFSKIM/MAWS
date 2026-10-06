import { describe, expect, it } from 'vitest';
import { IpcErrorSchema } from './errors';
import { NAMES, MAIN_ONLY_COMMANDS } from './names';
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
import { SETTINGS_DEFAULTS_V9 } from '../settings/defaults';
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
// E4a start
import * as browser from './schema/browser';
// E4a end

// One entry per namespace, checked against NAMESPACES at compile time and at run time.
const modules = { session, engine, fs, git, pty, layout, attention, settings, files /* C8c */, plugins, marketplaces /* E8 */, voice /* E9 */, maws /* E1 */, scm /* E6 */, side /* E3 */, deliverables /* E2 */, browser /* E4a */ } satisfies Record<
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
    const state = { settings: { ...SETTINGS_DEFAULTS_V9, theme: 'system' }, resolvedTheme: 'dark' };

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
      const changed = { settings: { ...SETTINGS_DEFAULTS_V9, theme: 'light' }, resolvedTheme: 'light' };
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
      plugins: [], pluginErrors: [], pluginWarnings: [], backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
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
      // `marketplaces`, E9's `voice`, E1's `maws`, E6's `scm`, E3's `side`, E2's `deliverables` and E4a's `browser` are the ones added since).
      const before = ['session', 'engine', 'fs', 'git', 'pty', 'layout', 'attention', 'settings'];
      for (const name of Object.keys(owners)) expect(before, name).toContain(name.split('.')[0]);
      expect(NAMESPACES.filter((ns) => !before.includes(ns))).toEqual(['files', 'plugins', 'marketplaces', 'voice', 'maws', 'scm', 'side', 'deliverables', 'browser']);
      for (const [name, owner] of Object.entries(owners)) expect(commands[name as keyof typeof owners].owner, name).toBe(owner);
      for (const name of Object.keys(owners)) expect(Object.hasOwn(events, name), name).toBe(false);
    });

    it('settings.get and settings.changed carry the whole version 3 state', () => {
      const state = { settings: { ...SETTINGS_DEFAULTS_V9, gateway: { defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false } }, resolvedTheme: 'light' };
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
      expect(Object.keys(plugins.commands)).toEqual(['plugins.env', 'plugins.list', 'plugins.available', 'plugins.install', 'plugins.update', 'plugins.uninstall', 'plugins.enable', 'plugins.disable', 'plugins.cancel']);
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
      const row = { id: 'p@m', name: 'p', marketplace: 'm', version: '0.1.0', scope: 'user', enabled: true, projectPath: null, installPath: '/c', errors: [], notes: [] };
      expect(validateCommandOutput('plugins.list', { plugins: [row] }).ok).toBe(true);
      expect(validateCommandOutput('marketplaces.list', { marketplaces: [{ name: 'm', source: 'directory', locator: '/m', installLocation: '/m' }] }).ok).toBe(true);
    });
  });
  // E8 end
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
      expect(Object.keys(maws.commands)).toEqual(['maws.asks.list', 'maws.ask.answer', 'maws.pane.answer', 'maws.artifact.captured' /* E2 */]);
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
      token, kind: 'push', cwd: '/r', program: '/usr/bin/git', argv: ['push', '--progress', 'origin', 'refs/heads/main:refs/heads/main'], remote: 'origin',
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
    it('adds the side namespace: two main commands, two engine-host commands, no event', () => {
      expect(Object.fromEntries(Object.entries(side.commands).map(([name, spec]) => [name, spec.owner]))).toEqual({
        'side.thread.open': 'main', 'side.sendToMain': 'main', 'side.question.list': 'engine-host', 'side.question.clear': 'engine-host',
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
  // E4a start: the browser view's commands and events (P1 ledger §5; E4a execution document, Interfaces "IPC")
  describe('E4a entries', () => {
    const TAB_ID = 'b_0123456789ab';
    const tab = {
      tabId: TAB_ID, appSessionId: 'a', partition: 'persist:maws-browser', url: 'https://example.com/', title: 'Example', favicon: null,
      loading: false, canGoBack: false, canGoForward: false, zoom: 1, control: 'idle', controlSince: 't', suspended: true,
      loadError: null, crashed: null, failed: null, unresponsive: false, blockedPopups: 0, find: null, denied: [], download: null,
      memoryKiB: null, placedIn: null, covered: false, createdAt: 't', lastShownAt: 't',
    };

    it('adds the browser namespace, main-owned throughout, every name bridged', () => {
      expect(Object.keys(browser.commands)).toEqual([
        'browser.tabs.list', 'browser.tabs.open', 'browser.tabs.close', 'browser.tabs.select', 'browser.tabs.navigate', 'browser.tabs.zoom',
        'browser.tabs.find', 'browser.tabs.dismiss', 'browser.tabs.devtools', 'browser.tabs.revealDownload', 'browser.view.place',
        'browser.view.cover', 'browser.control.handBack', 'browser.history.suggest', 'browser.profiles.list',
      ]);
      for (const spec of Object.values(browser.commands)) expect(spec.owner).toBe('main');
      expect(Object.keys(browser.events)).toEqual([
        'browser.tabs.changed', 'browser.view.covered', 'browser.control.changed', 'browser.chrome.command', 'browser.download.refused', 'browser.notice',
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
      expect(validateCommandOutput('browser.history.suggest', { suggestions: [{ url: 'https://a.b/', title: null }] }).ok).toBe(true);
      expect(validateCommandInput('browser.profiles.list', undefined).ok).toBe(true);
      expect(validateCommandOutput('browser.profiles.list', { profiles: [{ profileDir: 'Default', name: 'Work' }] }).ok).toBe(true);
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
});

// P4-AGG M2 (Decision Log 8): main's read-only watch on the files the engine's plugin state lives in, for the
// configuration and each cwd the catalog holds: a change to one of them, debounced, says which views to forget.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateWatch, type PollFn, type WatchFn } from './state-watch';

function fakeWatch(existing: ReadonlySet<string>) {
  const listeners = new Map<string, (event: string, filename: string | null) => void>();
  const closed: string[] = [];
  const watch: WatchFn = (dir, listener) => {
    if (!existing.has(dir)) throw Object.assign(new Error(`ENOENT ${dir}`), { code: 'ENOENT' });
    listeners.set(dir, listener);
    return { close: () => void (closed.push(dir), listeners.delete(dir)), on: () => undefined };
  };
  const fire = (dir: string, filename: string | null) => listeners.get(dir)!('change', filename);
  return { watch, listeners, closed, fire };
}

function fakePoll() {
  const polled = new Map<string, () => void>();
  const poll: PollFn = (path, listener) => {
    polled.set(path, listener);
    return { close: () => void polled.delete(path) };
  };
  return { poll, polled, change: (path: string) => polled.get(path)!() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the engine state watch', () => {
  it('watches the configuration, the plugins folder and each project’s .claude, and says which views a change touches', () => {
    const fake = fakeWatch(new Set(['/c', '/c/plugins', '/p/.claude', '/q']));
    const polls = fakePoll();
    const changes: (string | null)[] = [];
    const state = new StateWatch({ onChange: (scope) => changes.push(scope), watch: fake.watch, poll: polls.poll });
    state.sync({ configHome: '/c', pluginsDir: '/c/plugins', globalConfig: null, projects: ['/p', '/q'] });
    expect([...fake.listeners.keys()].sort()).toEqual(['/c', '/c/plugins', '/p/.claude']); // /q has no .claude yet: its settings files polled
    expect([...polls.polled.keys()]).toEqual(expect.arrayContaining(['/q/.claude/settings.json', '/q/.claude/settings.local.json']));
    fake.fire('/c/plugins', 'plugin-directory-cache-v2.json'); // the engine's own walk cache: not plugin state
    fake.fire('/c', 'history.jsonl');
    fake.fire('/p/.claude', 'agents');
    vi.advanceTimersByTime(1_000);
    expect(changes).toEqual([]);
    fake.fire('/p/.claude', 'settings.local.json');
    vi.advanceTimersByTime(300);
    expect(changes).toEqual(['/p']);
    polls.change('/q/.claude/settings.json'); // created: its settings now apply
    fake.fire('/c/plugins', 'installed_plugins.json');
    vi.advanceTimersByTime(300);
    expect(changes).toEqual(['/p', 'all']); // a configuration change covers every view
  });

  it('gathers a burst into one change, flushed within a second even while it lasts', () => {
    const fake = fakeWatch(new Set(['/c']));
    const changes: (string | null)[] = [];
    new StateWatch({ onChange: (scope) => changes.push(scope), watch: fake.watch, poll: fakePoll().poll }).sync({ configHome: '/c', pluginsDir: null, globalConfig: null, projects: [] });
    for (let i = 0; i < 8; i += 1) {
      fake.fire('/c', 'settings.json');
      vi.advanceTimersByTime(200);
    }
    expect(changes).toEqual(['all']);
  });

  it('follows the held cwds: a cwd no longer held is unwatched, and close releases everything', () => {
    const fake = fakeWatch(new Set(['/c', '/p/.claude', '/q/.claude']));
    const polls = fakePoll();
    const state = new StateWatch({ onChange: () => {}, watch: fake.watch, poll: polls.poll });
    state.sync({ configHome: '/c', pluginsDir: '/c/plugins' /* absent: not watched */, globalConfig: null, projects: ['/p', '/q'] });
    state.sync({ configHome: '/c', pluginsDir: '/c/plugins', globalConfig: null, projects: ['/q'] });
    expect(fake.closed).toEqual(['/p/.claude']);
    expect(polls.polled.has('/p/.mcp.json')).toBe(false);
    state.close();
    expect(fake.listeners.size).toBe(0);
    expect(polls.polled.size).toBe(0);
  });

  it('polls each MCP configuration file that applies, and puts no folder watch on the home folder or above a project (scalpel-3#1)', () => {
    const fake = fakeWatch(new Set(['/h', '/h/.claude', '/h/w', '/h/w/p', '/h/w/p/.claude', '/u', '/srv', '/srv/x']));
    const polls = fakePoll();
    const changes: [string, string][] = [];
    const state = new StateWatch({ onChange: (scope, kind) => changes.push([scope, kind]), watch: fake.watch, poll: polls.poll, appSettings: '/u/settings.json' });
    state.sync({ configHome: '/h/.claude', pluginsDir: null, globalConfig: '/h/.claude.json', projects: ['/h/w/p', '/srv/x'] });
    // folders: the configuration's and each project's own .claude only (an FSEvents stream covers a folder's whole tree)
    expect([...fake.listeners.keys()].sort()).toEqual(['/h/.claude', '/h/w/p/.claude']);
    for (const dir of ['/', '/h', '/h/w', '/h/w/p', '/u', '/srv', '/srv/x']) expect(fake.listeners.has(dir), dir).toBe(false);
    // files: the global file, MAWS's settings, and .mcp.json up each project's ancestors, never '/'
    expect([...polls.polled.keys()].sort()).toEqual(['/h/.claude.json', '/h/.mcp.json', '/h/w/.mcp.json', '/h/w/p/.mcp.json', '/srv/.mcp.json', '/srv/x/.claude/settings.json', '/srv/x/.claude/settings.local.json', '/srv/x/.mcp.json', '/u/settings.json']);
    polls.change('/h/w/.mcp.json');
    vi.advanceTimersByTime(300);
    polls.change('/h/.claude.json');
    vi.advanceTimersByTime(300);
    polls.change('/u/settings.json');
    vi.advanceTimersByTime(300);
    expect(changes).toEqual([['all', 'mcp'], ['all', 'mcp'], ['all', 'mcp']]);
    fake.fire('/h/w/p/.claude', 'settings.json'); // the plugin state, as before, in the same window as an MCP change
    polls.change('/h/.mcp.json');
    vi.advanceTimersByTime(300);
    expect(changes.slice(3)).toEqual([['/h/w/p', 'plugins'], ['all', 'mcp']]);
    state.close();
    expect(polls.polled.size).toBe(0);
  });

  it('polls .mcp.json in every ancestor the engine reads, above the home folder too, never the root (fix-D#3)', () => {
    const fake = fakeWatch(new Set(['/Users/me/w/p/.claude']));
    const polls = fakePoll();
    const changes: [string, string][] = [];
    const state = new StateWatch({ onChange: (scope, kind) => changes.push([scope, kind]), watch: fake.watch, poll: polls.poll });
    state.sync({ configHome: null, pluginsDir: null, globalConfig: null, projects: ['/Users/me/w/p'] });
    // the inventory reads every ancestor's .mcp.json below '/' (customization/inventory.ts), so a change to /Users/.mcp.json must be heard
    expect([...polls.polled.keys()].sort()).toEqual(['/Users/.mcp.json', '/Users/me/.mcp.json', '/Users/me/w/.mcp.json', '/Users/me/w/p/.mcp.json']);
    expect([...fake.listeners.keys()]).toEqual(['/Users/me/w/p/.claude']);
    polls.change('/Users/.mcp.json');
    vi.advanceTimersByTime(300);
    expect(changes).toEqual([['all', 'mcp']]);
    state.close();
  });
});

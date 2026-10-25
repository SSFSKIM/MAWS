// P4-AGG M2 (Decision Log 8): main's read-only watch on the files the engine's plugin state lives in, for the
// configuration and each cwd the catalog holds: a change to one of them, debounced, says which views to forget.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateWatch, type WatchFn } from './state-watch';

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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the engine state watch', () => {
  it('watches the configuration, the plugins folder and each project’s .claude, and says which views a change touches', () => {
    const fake = fakeWatch(new Set(['/c', '/c/plugins', '/p/.claude', '/q']));
    const changes: (string | null)[] = [];
    const state = new StateWatch({ onChange: (scope) => changes.push(scope), watch: fake.watch });
    state.sync({ configHome: '/c', pluginsDir: '/c/plugins', globalConfig: null, projects: ['/p', '/q'] });
    expect([...fake.listeners.keys()].sort()).toEqual(['/c', '/c/plugins', '/p/.claude', '/q']); // /q has no .claude yet: its parent
    fake.fire('/c/plugins', 'plugin-directory-cache-v2.json'); // the engine's own walk cache: not plugin state
    fake.fire('/c', 'history.jsonl');
    fake.fire('/p/.claude', 'agents');
    vi.advanceTimersByTime(1_000);
    expect(changes).toEqual([]);
    fake.fire('/p/.claude', 'settings.local.json');
    vi.advanceTimersByTime(300);
    expect(changes).toEqual(['/p']);
    fake.fire('/q', '.claude'); // created: its settings may now apply
    fake.fire('/c/plugins', 'installed_plugins.json');
    vi.advanceTimersByTime(300);
    expect(changes).toEqual(['/p', 'all']); // a configuration change covers every view
  });

  it('gathers a burst into one change, flushed within a second even while it lasts', () => {
    const fake = fakeWatch(new Set(['/c']));
    const changes: (string | null)[] = [];
    new StateWatch({ onChange: (scope) => changes.push(scope), watch: fake.watch }).sync({ configHome: '/c', pluginsDir: null, globalConfig: null, projects: [] });
    for (let i = 0; i < 8; i += 1) {
      fake.fire('/c', 'settings.json');
      vi.advanceTimersByTime(200);
    }
    expect(changes).toEqual(['all']);
  });

  it('follows the held cwds: a cwd no longer held is unwatched, and close releases everything', () => {
    const fake = fakeWatch(new Set(['/c', '/p/.claude', '/q/.claude']));
    const state = new StateWatch({ onChange: () => {}, watch: fake.watch });
    state.sync({ configHome: '/c', pluginsDir: '/c/plugins' /* absent: not watched */, globalConfig: null, projects: ['/p', '/q'] });
    state.sync({ configHome: '/c', pluginsDir: '/c/plugins', globalConfig: null, projects: ['/q'] });
    expect(fake.closed).toEqual(['/p/.claude']);
    state.close();
    expect(fake.listeners.size).toBe(0);
  });

  it('watches every MCP configuration that applies: the global file, MAWS’s app servers, and .mcp.json up each project’s ancestors to the home folder (scalpel-3#1)', () => {
    const fake = fakeWatch(new Set(['/h', '/h/.claude', '/h/w', '/h/w/p', '/h/w/p/.claude', '/u', '/srv', '/srv/x']));
    const changes: [string, string][] = [];
    const state = new StateWatch({ onChange: (scope, kind) => changes.push([scope, kind]), watch: fake.watch, home: '/h', appSettings: '/u/settings.json' });
    state.sync({ configHome: '/h/.claude', pluginsDir: null, globalConfig: '/h/.claude.json', projects: ['/h/w/p', '/srv/x'] });
    expect([...fake.listeners.keys()].sort()).toEqual(['/h', '/h/.claude', '/h/w', '/h/w/p', '/h/w/p/.claude', '/srv', '/srv/x', '/u']); // never '/', nor above the home folder
    fake.fire('/h/w', '.mcp.json');
    vi.advanceTimersByTime(300);
    fake.fire('/h', '.claude.json');
    vi.advanceTimersByTime(300);
    fake.fire('/u', 'settings.json');
    vi.advanceTimersByTime(300);
    fake.fire('/h/w/p', 'notes.md');
    vi.advanceTimersByTime(300);
    expect(changes).toEqual([['all', 'mcp'], ['all', 'mcp'], ['all', 'mcp']]);
    fake.fire('/h/w/p/.claude', 'settings.json'); // the plugin state, as before, in the same window as an MCP change
    fake.fire('/h', '.mcp.json');
    vi.advanceTimersByTime(300);
    expect(changes.slice(3)).toEqual([['/h/w/p', 'plugins'], ['all', 'mcp']]);
  });
});

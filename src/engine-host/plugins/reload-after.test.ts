// E8 M1 (D-4): after a successful mutation, a settled reload_plugins in every ready session, each verified against its
// own expectation, retried once when it disagrees, and reported per session; a rejected reload is that session's outcome.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ReloadPluginsResponse } from '@shared/wire/control';
import { expectationOf, reloadAfter, SETTLE_MS, type ReloadChange, type ReloadTarget } from './reload-after';

let root: string;
let here: string;
let there: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-reload-after-')));
  here = join(root, 'here');
  there = join(root, 'there');
  mkdirSync(here);
  mkdirSync(there);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const answer = (...names: string[]): ReloadPluginsResponse => ({ commands: [], agents: [], plugins: names.map((name) => ({ name, path: `/p/${name}`, source: `${name}@m` })), mcpServers: [], error_count: 0 });

// A session whose successive reloads answer `answers` in turn (an Error rejects), logging each into `log`.
function target(id: string, directory: string, log: string[], ...answers: (ReloadPluginsResponse | Error)[]): ReloadTarget {
  let n = 0;
  return {
    id: id as AppSessionId,
    directory,
    reload: async () => {
      log.push(`reload ${id}`);
      const next = answers[Math.min(n++, answers.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function run(change: ReloadChange, targets: ReloadTarget[], log: string[]) {
  return reloadAfter(change, () => targets, { sleep: async (ms) => void log.push(`sleep ${ms}`) });
}

const install = (scope: ReloadChange['scope'] = 'user'): ReloadChange => ({ action: 'install', scope, cwd: here, plugin: 'e8-probe' });

describe('reloadAfter', () => {
  it('settles first, then reloads every ready session in parallel; a user-scope install is expected everywhere', async () => {
    const log: string[] = [];
    const sessions = await run(install(), [target('a', here, log, answer('e8-probe')), target('b', there, log, answer('other', 'e8-probe'))], log);
    expect(log.slice(0, 3)).toEqual([`sleep ${SETTLE_MS}`, 'reload a', 'reload b']);
    expect(sessions).toEqual([
      { appSessionId: 'a', outcome: 'reflected', error: null },
      { appSessionId: 'b', outcome: 'reflected', error: null },
    ]);
  });

  it('holds a project or local change against the session in its directory only (realpaths compared)', async () => {
    const linked = join(root, 'linked');
    symlinkSync(here, linked);
    for (const scope of ['project', 'local'] as const) {
      const log: string[] = [];
      const sessions = await run(install(scope), [target('a', linked, log, answer('e8-probe')), target('b', there, log, answer())], log);
      expect(sessions, scope).toEqual([
        { appSessionId: 'a', outcome: 'reflected', error: null },
        { appSessionId: 'b', outcome: 'no_expectation', error: null }, // reloaded, but the change does not reach it
      ]);
      expect(log.filter((l) => l === 'reload b'), scope).toHaveLength(1);
    }
  });

  it('reloads a disagreeing session once more after another settle, then reports not_reflected', async () => {
    const log: string[] = [];
    const late = target('late', here, log, answer(), answer('e8-probe'));
    const never = target('never', there, log, answer(), answer());
    const sessions = await run(install(), [late, never], log);
    expect(sessions).toEqual([
      { appSessionId: 'late', outcome: 'reflected', error: null },
      { appSessionId: 'never', outcome: 'not_reflected', error: null },
    ]);
    expect(log.filter((l) => l === 'reload never')).toHaveLength(2); // never retried further
    expect(log.filter((l) => l === `sleep ${SETTLE_MS}`)).toHaveLength(3); // the first settle, then one per disagreeing session
  });

  it('expects the plugin absent after uninstall and disable', async () => {
    for (const action of ['uninstall', 'disable'] as const) {
      const log: string[] = [];
      const sessions = await run({ action, scope: 'user', cwd: here, plugin: 'e8-probe' }, [target('a', here, log, answer('e8-probe'), answer('other'))], log);
      expect(sessions, action).toEqual([{ appSessionId: 'a', outcome: 'reflected', error: null }]);
    }
  });

  it('holds no expectation after an update or a marketplace refresh or removal, whatever the scope', async () => {
    for (const action of ['update', 'marketplace-update', 'marketplace-remove'] as const) {
      const log: string[] = [];
      const sessions = await run({ action, scope: 'user', cwd: here, plugin: action === 'update' ? 'e8-probe' : null }, [target('a', here, log, answer())], log);
      expect(sessions, action).toEqual([{ appSessionId: 'a', outcome: 'no_expectation', error: null }]);
      expect(log.filter((l) => l === 'reload a'), action).toHaveLength(1);
    }
    expect(expectationOf('install')).toBe('present');
    expect(expectationOf('enable')).toBe('present');
    expect(expectationOf('uninstall')).toBe('absent');
    expect(expectationOf('disable')).toBe('absent');
    expect(expectationOf('update')).toBeNull();
  });

  it('settles each session independently: one answering and one timing out complete reflected and failed', async () => {
    const log: string[] = [];
    const sessions = await run(install(), [target('ok', here, log, answer('e8-probe')), target('slow', there, log, new Error('reload_plugins unanswered after 120 s'))], log);
    expect(sessions).toEqual([
      { appSessionId: 'ok', outcome: 'reflected', error: null },
      { appSessionId: 'slow', outcome: 'failed', error: 'reload_plugins unanswered after 120 s' },
    ]);
  });

  it('a retry that rejects is the session’s failure', async () => {
    const log: string[] = [];
    const sessions = await run(install(), [target('a', here, log, answer(), new Error('reload_plugins unanswered: the process exited'))], log);
    expect(sessions).toEqual([{ appSessionId: 'a', outcome: 'failed', error: 'reload_plugins unanswered: the process exited' }]);
  });

  it('with no ready session reloads nothing and waits for nothing', async () => {
    const log: string[] = [];
    expect(await run(install(), [], log)).toEqual([]);
    expect(log).toEqual([]);
  });

  it('reloads the sessions ready after the settle, not before it', async () => {
    const log: string[] = [];
    const first = target('first', here, log, answer('e8-probe'));
    const second = target('second', here, log, answer('e8-probe'));
    let ready = [first];
    const sessions = await reloadAfter(install(), () => ready, {
      sleep: async (ms) => {
        log.push(`sleep ${ms}`);
        ready = [first, second];
      },
    });
    expect(sessions.map((s) => s.appSessionId)).toEqual(['first', 'second']);
  });
});

// P5 O15 M4's row 10 script (deploy/vm/o15-tools.mjs): the session's end however the run ends, a signal while its start
// is still pending included, and the engine's global config file, chosen as the engine's own trust reader chooses it.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type ConfigFile = (env: NodeJS.ProcessEnv, exists: (path: string) => boolean) => string;
type Script = {
  configFilePath: ConfigFile;
  endSession: (link: Link, app: string, start: Promise<unknown> | null, o: Record<string, number | boolean>) => Promise<{ ok: boolean; why: string; detail: string }>;
};
// The script, a plain .mjs with no declarations, and the engine's own reader in MAWS's tree, each loaded by its path.
const load = async () => (await import(join(import.meta.dirname, '../../deploy/vm/o15-tools.mjs'))) as Script;
const engine = async () => ((await import(join(import.meta.dirname, '../../../../src/shared/engine/config-dir.ts'))) as { configFilePath: ConfigFile }).configFilePath;

type Link = { request(name: string, input: Record<string, unknown>, ms?: number): Promise<unknown> };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The error the script's link throws for an answer the engine host refused: `unknownSession` for its `unknown session`. */
const refused = (name: string, code: string, unknownSession = false) => Object.assign(new Error(`${name}: ${code}`), { code, unknownSession });

/** mawsd, faked: a start answered after `startMs` whose launch lands `launchMs` later; a stop ends a live process and is
 * answered `unknown session` when none runs; `dead` makes every request fail as a closed link does, `down` as the
 * daemon answers while the engine host is not running (`host_unavailable`). */
function machine(o: { startMs: number; launchMs: number; dead?: boolean; down?: boolean }) {
  let process: 'ready' | 'exited' | null = null;
  const calls: string[] = [];
  const link: Link = {
    async request(name) {
      calls.push(`${name}${name === 'session.stop' ? ` (${process ?? 'none'})` : ''}`);
      if (o.dead) throw new Error('mawsd closed the connection');
      if (o.down && name !== 'session.start') throw refused(name, 'host_unavailable');
      if (name === 'session.start') {
        await sleep(o.startMs);
        setTimeout(() => (process = 'ready'), o.launchMs);
        return { status: 'starting' };
      }
      if (name === 'session.stop') {
        if (process !== 'ready') throw refused(name, 'internal', true);
        process = 'exited';
        return { exited: true, code: 0, signal: null };
      }
      if (name === 'session.status') {
        if (process === null) throw refused(name, 'internal', true);
        return { process };
      }
      throw new Error(`${name}: unknown_command`);
    },
  };
  return { link, calls, state: () => process };
}

const quick = { startMs: 2000, settleMs: 400, everyMs: 20 };

describe('the row 10 script’s end of its session', () => {
  it('ends a session whose start was still pending when the signal came, its late launch included', async () => {
    const { endSession } = await load();
    const m = machine({ startMs: 100, launchMs: 60 });
    const start = m.link.request('session.start', {});
    const ended = await endSession(m.link, 'app-1', start, quick); // the signal: the start not answered yet
    expect(ended.ok).toBe(true);
    expect(m.state()).toBe('exited');
    // the first stop found nothing running (the launch not landed yet); the watch stopped the late launch
    expect(m.calls.filter((c) => c.startsWith('session.stop'))).toEqual(['session.stop (none)', 'session.stop (ready)']);
  });

  it('leaves the end unconfirmed while the start is still pending when its wait expires', async () => {
    const { endSession } = await load();
    const m = machine({ startMs: 5000, launchMs: 0 });
    const ended = await endSession(m.link, 'app-1', m.link.request('session.start', {}), { startMs: 50, settleMs: 100, everyMs: 20 });
    expect(ended).toMatchObject({ ok: false, why: 'end unconfirmed: start still pending' });
  });

  it('leaves the end unconfirmed when the start answered starting and no launch was seen', async () => {
    const { endSession } = await load();
    const m = machine({ startMs: 0, launchMs: 5000 });
    const ended = await endSession(m.link, 'app-1', m.link.request('session.start', {}), quick);
    expect(ended).toMatchObject({ ok: false, why: 'end unconfirmed: the start answered starting and no launch was seen' });
  });

  it('settles and leaves no timer behind once the start answered before its wait ran out', async () => {
    const { endSession } = await load();
    const m = machine({ startMs: 0, launchMs: 0 });
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const start = m.link.request('session.start', {});
    await sleep(10); // the fake's own launch timer has fired
    const before = timers();
    expect(await endSession(m.link, 'app-1', start, { startMs: 600_000, settleMs: 50, everyMs: 10, seenLive: true })).toMatchObject({ ok: true });
    expect(timers()).toBe(before); // the start's 600 s wait, which lost its race, was called off
  });

  it('never reads host_unavailable as ended', async () => {
    const { endSession } = await load();
    const m = machine({ startMs: 0, launchMs: 0, down: true });
    expect(await endSession(m.link, 'app-1', null, quick)).toMatchObject({ ok: false, why: 'not shown ended', detail: expect.stringMatching(/stop: unread \(session\.stop: host_unavailable\).*last read unread$/) });
  });

  it('ends a session that is running, and one that never launched', async () => {
    const { endSession } = await load();
    const running = machine({ startMs: 0, launchMs: 0 });
    await running.link.request('session.start', {});
    await sleep(10);
    expect(await endSession(running.link, 'app-1', null, { ...quick, seenLive: true })).toMatchObject({ ok: true });
    expect(running.state()).toBe('exited');
    expect((await endSession(machine({ startMs: 0, launchMs: 0 }).link, 'app-2', null, quick)).ok).toBe(true);
  });

  it('does not call a session ended when the link failed', async () => {
    const { endSession } = await load();
    const m = machine({ startMs: 0, launchMs: 0, dead: true });
    expect(await endSession(m.link, 'app-1', Promise.reject(new Error('mawsd closed the connection')), quick)).toMatchObject({ ok: false, why: 'not shown ended', detail: expect.stringMatching(/stop: unread.*last read unread$/) });
  });
});

describe('the row 10 script’s engine config file', () => {
  it('is the file the engine’s trust reader chooses, for each environment', async () => {
    const { configFilePath } = await load();
    const engineConfigFile = await engine();
    const cases: Array<[NodeJS.ProcessEnv, string[]]> = [
      [{ HOME: '/h' }, []],
      [{ HOME: '/h' }, ['/h/.claude/.config.json']],
      [{ HOME: '/h', CLAUDE_CONFIG_DIR: '/c' }, []],
      [{ HOME: '/h', CLAUDE_CONFIG_DIR: '/c' }, ['/c/.config.json']],
      [{ HOME: '/h', CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://x' }, []],
      [{ HOME: '/h', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://x' }, []],
    ];
    for (const [env, present] of cases) {
      const exists = (path: string) => present.includes(path);
      expect(configFilePath(env, exists), JSON.stringify([env, present])).toBe(engineConfigFile(env, exists));
    }
    expect(configFilePath({ HOME: '/h', CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://x' }, () => false)).toBe('/h/.claude-custom-oauth.json');
  });
});

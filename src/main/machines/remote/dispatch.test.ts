// The router's path to an RL2 machine (P5 O7 M1, "The router's path", Interfaces §F).
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName } from '@shared/ipc/schema';
import { dispatchOverLink } from './dispatch';
import type { CallResult } from './link';

function link(answer: CallResult) {
  const calls: Array<[string, unknown, ...unknown[]]> = [];
  return { calls, name: 'mini', call: async (name: string, input: unknown, ...options: unknown[]) => (calls.push([name, input, ...options]), answer) };
}

const STATUS = 'session.status' as CommandName;

describe('dispatch over an RL2 link', () => {
  it('sends a `list` or `view` command as a call and checks its output', async () => {
    const ping = { pid: 7, uptimeMs: 1, hostVersion: 'v' };
    const good = link({ ok: true, output: ping });
    expect(await dispatchOverLink(good, 'engine.ping' as CommandName, undefined)).toEqual({ ok: true, value: ping });
    expect(good.calls).toEqual([['engine.ping', undefined]]);
    const bad = await dispatchOverLink(link({ ok: true, output: 'not a status' }), STATUS, { appSessionId: 'a' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('refuses an act-graded command locally, `act-required`, without a round trip', async () => {
    const l = link({ ok: true, output: null });
    expect(await dispatchOverLink(l, 'session.send' as CommandName, {})).toEqual({ ok: false, error: { code: 'internal', message: 'session.send: refused act-required by machine mini', issues: { refusal: 'act-required' } } });
    expect(l.calls).toEqual([]);
  });

  // P5 O7 M4: the session a path-class read is made from rides the call; the link decides whether the peer reads it.
  it('names the session a read is made from as the call’s lane B session, and nothing when none was', async () => {
    const l = link({ ok: false, error: { code: 'no-target' } });
    await dispatchOverLink(l, 'git.status' as CommandName, { directory: '/r/src' }, 'app-1' as AppSessionId);
    await dispatchOverLink(l, 'git.status' as CommandName, { directory: '/r/src' });
    expect(l.calls).toEqual([
      ['git.status', { directory: '/r/src' }, { session: { lane: 'B', id: 'app-1' } }],
      ['git.status', { directory: '/r/src' }],
    ]);
  });

  it('answers host_unavailable for a command that does not cross a machine link', async () => {
    expect(await dispatchOverLink(link({ ok: true, output: null }), 'machines.list' as CommandName, undefined)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });

  it('maps each refusal (§F)', async () => {
    const mapped = async (code: string) => (await dispatchOverLink(link({ ok: false, error: { code, message: 'm' } }), STATUS, { appSessionId: 'a' })) as { ok: false; error: unknown };
    expect((await mapped('offline')).error).toMatchObject({ code: 'host_unavailable' });
    expect((await mapped('unavailable')).error).toMatchObject({ code: 'host_unavailable' });
    expect((await mapped('timeout')).error).toMatchObject({ code: 'timeout' });
    expect((await mapped('invalid_input')).error).toMatchObject({ code: 'invalid_input' });
    expect((await mapped('grade')).error).toEqual({ code: 'internal', message: 'session.status: refused grade by machine mini', issues: { refusal: 'grade' } });
  });
});

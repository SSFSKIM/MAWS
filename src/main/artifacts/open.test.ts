// P3-A M4: main's `artifacts.open` (docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 13). Main checks the
// artifact is a live document kind, makes one channel per open, hands one end to the engine host on its parent port with
// the human as actor and posts the other to the asking window on `maws:doc-port`, and answers the channel number the
// window awaits its port by. Nothing is posted anywhere when the host is not there to take its end.
import { describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '@shared/ipc/schema';
import { CommandFailure } from '../ipc/router';
import { DOC_PORT_CHANNEL, openDocument, type DocOpenDeps } from './open';

const ID = '11111111-1111-4111-8111-111111111111';
const row = (kind: string) => ({ id: ID, kind, title: 'Plan', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 4 });

function harness(answer: CommandResult<'artifacts.get'>, posted = true) {
  const ports: { name: string; closed: boolean }[] = [];
  const port = (name: string) => {
    const p = { name, closed: false, close: () => void (p.closed = true) };
    ports.push(p);
    return p;
  };
  const dispatch = vi.fn(async () => answer);
  const postDocPort = vi.fn(() => posted);
  let next = 0;
  const deps: DocOpenDeps = {
    dispatch: dispatch as never,
    postDocPort: postDocPort as never,
    channel: () => {
      next += 1;
      return { port1: port(`host-${next}`), port2: port(`window-${next}`) } as never;
    },
  };
  const sender = { postMessage: vi.fn(), isDestroyed: () => false };
  return { deps, dispatch, postDocPort, sender, ports };
}

describe('artifacts.open (main)', () => {
  it('hands the host its end with the human as actor and the window the other, under a fresh channel each time', async () => {
    const h = harness({ ok: true, value: { artifact: row('document') as never } });
    const first = await openDocument(h.deps, ID, h.sender as never);
    const second = await openDocument(h.deps, ID, h.sender as never);
    expect(first.channel).not.toBe(second.channel);
    expect(h.dispatch).toHaveBeenCalledWith('engine-host', 'artifacts.get', { artifactId: ID });
    expect(h.postDocPort).toHaveBeenNthCalledWith(1, { t: 'doc', channel: first.channel, artifactId: ID, actor: { kind: 'human' } }, h.ports[0]);
    expect(h.sender.postMessage).toHaveBeenNthCalledWith(1, DOC_PORT_CHANNEL, { channel: first.channel, artifactId: ID }, [h.ports[1]]);
    expect(h.ports.every((p) => !p.closed)).toBe(true);
  });

  it('refuses a byte kind as invalid and a missing artifact as notFound, opening no channel', async () => {
    for (const [answer, reason] of [
      [{ ok: true, value: { artifact: row('html') } }, 'invalid'],
      [{ ok: true, value: { artifact: null } }, 'notFound'],
    ] as const) {
      const h = harness(answer as never);
      const error = await openDocument(h.deps, ID, h.sender as never).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CommandFailure);
      expect((error as CommandFailure).error).toMatchObject({ code: 'invalid_input', issues: { reason } });
      expect(h.ports).toEqual([]);
      expect(h.postDocPort).not.toHaveBeenCalled();
    }
  });

  it('relays the host’s own refusal of the lookup as it came', async () => {
    const h = harness({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is restarting' } });
    const error = (await openDocument(h.deps, ID, h.sender as never).catch((e: unknown) => e)) as CommandFailure;
    expect(error.error).toEqual({ code: 'host_unavailable', message: 'engine-host is restarting' });
  });

  it('closes both ends and answers host_unavailable when the host cannot take its end, posting nothing to the window', async () => {
    const h = harness({ ok: true, value: { artifact: row('document') as never } }, false);
    const error = (await openDocument(h.deps, ID, h.sender as never).catch((e: unknown) => e)) as CommandFailure;
    expect(error.error.code).toBe('host_unavailable');
    expect(h.ports.map((p) => p.closed)).toEqual([true, true]);
    expect(h.sender.postMessage).not.toHaveBeenCalled();
  });

  it('opens nothing for a window that went while the lookup was in flight', async () => {
    const h = harness({ ok: true, value: { artifact: row('document') as never } });
    const gone = { postMessage: vi.fn(), isDestroyed: () => true };
    await expect(openDocument(h.deps, ID, gone as never)).rejects.toBeInstanceOf(CommandFailure);
    expect(h.postDocPort).not.toHaveBeenCalled();
  });
});

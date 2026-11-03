// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3); the ledger's E3 hold-IPC
// row): a window's holds over snapshot bytes, main's `artifacts.holdDatasets` and `artifacts.releaseDatasets`. Main takes
// the host's hold and answers an unforgeable handle bound to the asking window: another window cannot release it, and the
// window's closing, navigating or crashing releases every hold it took, released or not by its page. A hold that lands
// after its window went is released at once; the host's going takes its holds with it, so main forgets theirs.
// P5 O7 M5c round 3: another machine's artifact is held on its machine, over that machine's link (the endpoint's
// per-channel holds, behind `rl2.asset-holds`); a machine whose endpoint doesn't list it draws unheld, said once.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { commands } from '@shared/ipc/schema/artifacts';
import type { MachineRef } from '@shared/machine/ref';
import { CommandFailure } from '../ipc/router';
import { clientOf } from '../ipc/clients';
import { createDatasetHolds } from './holds';

const ID = '00000000-0000-4000-8000-0000000000d1';

class Window extends EventEmitter {
  destroyed = false;
  constructor(readonly id: number) {
    super();
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.emit('destroyed');
  }
}
const owner = (window: Window) => clientOf(window as never); // the router's ClientRef for the window's page

function host() {
  const held = new Set<string>();
  const log: string[] = [];
  let next = 0;
  let gate: Promise<void> | null = null;
  const call = vi.fn(async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> => {
    if (name === 'artifacts.holdAssets') {
      const { refs } = input as CommandInput<'artifacts.holdAssets'>;
      if (gate) await gate;
      if (refs.includes('assets/gone.json')) return { ok: false, error: ipcError('invalid_input', 'the snapshot assets/gone.json is unavailable', { reason: 'notFound', data: { ref: 'assets/gone.json', snapshotUnavailable: true } }) } as never;
      const assetHoldId = `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
      held.add(assetHoldId);
      log.push(`hold ${refs.join(',')}`);
      return { ok: true, value: { assetHoldId } } as never;
    }
    if (name === 'artifacts.releaseAssets') {
      const { assetHoldId } = input as CommandInput<'artifacts.releaseAssets'>;
      log.push(`release ${assetHoldId.slice(-1)}`);
      return { ok: true, value: { released: held.delete(assetHoldId) } } as never;
    }
    throw new Error(`unexpected ${name}`);
  });
  return { call, held, log, hold: (until: Promise<void> | null) => (gate = until) };
}

describe('a window’s dataset holds (E3)', () => {
  it('are main’s commands, renderer-callable', () => {
    expect(commands['artifacts.holdDatasets'].owner).toBe('main');
    expect(commands['artifacts.releaseDatasets'].owner).toBe('main');
  });

  it('takes the host’s hold and answers a handle only the asking window releases', async () => {
    const h = host();
    const holds = createDatasetHolds({ call: h.call as never });
    const one = new Window(1);
    const two = new Window(2);
    const { holdId } = await holds.hold({ artifactId: ID, refs: ['assets/a.json', 'assets/b.json'] }, owner(one));
    expect(h.log).toEqual(['hold assets/a.json,assets/b.json']);
    expect(holdId).toMatch(/^[0-9a-f-]{36}$/);
    expect(holdId).not.toBe([...h.held][0]); // the host's id never reaches the window
    expect(await holds.release({ holdId }, owner(two))).toEqual({ released: false });
    expect(h.held.size).toBe(1);
    expect(await holds.release({ holdId }, owner(one))).toEqual({ released: true });
    expect(h.held.size).toBe(0);
    expect(await holds.release({ holdId }, owner(one))).toEqual({ released: false }); // once
  });

  it('releases every hold of a window that closes, navigates or crashes, its page never asking', async () => {
    const h = host();
    const holds = createDatasetHolds({ call: h.call as never });
    for (const [k, end] of (['destroyed', 'did-start-navigation', 'render-process-gone'] as const).entries()) {
      const window = new Window(10 + k);
      await holds.hold({ artifactId: ID, refs: ['assets/a.json'] }, owner(window));
      const { holdId } = await holds.hold({ artifactId: ID, refs: ['assets/b.json'] }, owner(window));
      expect(h.held.size).toBe(2);
      if (end === 'destroyed') window.destroy();
      else window.emit(end, { isMainFrame: true, isSameDocument: false });
      await vi.waitFor(() => expect(h.held.size).toBe(0));
      expect(await holds.release({ holdId }, owner(window))).toEqual({ released: false });
    }
  });

  it('a navigated window holds again afresh; a hold landing after its window went is released at once and refused', async () => {
    const h = host();
    const holds = createDatasetHolds({ call: h.call as never });
    const window = new Window(3);
    await holds.hold({ artifactId: ID, refs: ['assets/a.json'] }, owner(window));
    window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    const { holdId } = await holds.hold({ artifactId: ID, refs: ['assets/c.json'] }, owner(window));
    await vi.waitFor(() => expect(h.held.size).toBe(1));
    expect(await holds.release({ holdId }, owner(window))).toEqual({ released: true });
    let open!: () => void;
    h.hold(new Promise<void>((resolve) => (open = resolve)));
    const late = holds.hold({ artifactId: ID, refs: ['assets/d.json'] }, owner(window));
    window.destroy();
    open();
    await expect(late).rejects.toThrow(/gone/);
    await vi.waitFor(() => expect(h.held.size).toBe(0));
    await expect(holds.hold({ artifactId: ID, refs: ['assets/e.json'] }, owner(window))).rejects.toThrow(/closed/);
  });

  it('passes the host’s refusal through, holding nothing', async () => {
    const h = host();
    const holds = createDatasetHolds({ call: h.call as never });
    const refused = await holds.hold({ artifactId: ID, refs: ['assets/a.json', 'assets/gone.json'] }, owner(new Window(4))).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CommandFailure);
    expect((refused as CommandFailure).error).toMatchObject({ issues: { reason: 'notFound', data: { snapshotUnavailable: true } } });
    expect(h.held.size).toBe(0);
  });

  it('forgets the host’s holds when the host goes (it released them), answering the window’s release without asking it', async () => {
    const h = host();
    const holds = createDatasetHolds({ call: h.call as never });
    const window = new Window(5);
    const { holdId } = await holds.hold({ artifactId: ID, refs: ['assets/a.json'] }, owner(window));
    holds.hostLost();
    h.call.mockClear();
    expect(await holds.release({ holdId }, owner(window))).toEqual({ released: true });
    expect(h.call).not.toHaveBeenCalled();
  });
});

const REMOTE_ID = '00000000-0000-4000-8000-0000000000e2';
const MINI = 'mini-machine-ref-0001' as MachineRef;

/** Another machine's link as main's holds reach it: its current channel (the peer's list, one array per channel) and its calls. */
function machineLink(capabilities: readonly string[] = ['rl2.artifacts', 'rl2.asset-holds']) {
  const held = new Set<string>();
  const asked: Array<{ name: string; input: unknown; options: unknown }> = [];
  let next = 0;
  let channel: readonly string[] | null = [...capabilities];
  let gate: Promise<void> | null = null;
  const link = {
    name: 'mini',
    peerCapabilities: () => channel,
    call: vi.fn(async (name: string, input: unknown, options?: unknown) => {
      asked.push({ name, input, options });
      if (name === 'artifacts.holdAssets') {
        if (gate) await gate;
        const assetHoldId = `00000000-0000-4000-9000-${String(++next).padStart(12, '0')}`;
        held.add(assetHoldId);
        return { ok: true as const, output: { assetHoldId } };
      }
      if (name === 'artifacts.releaseAssets') return { ok: true as const, output: { released: held.delete((input as { assetHoldId: string }).assetHoldId) } };
      return { ok: false as const, error: { code: 'not-offered' } };
    }),
  };
  return {
    link,
    held,
    asked,
    /** The channel replaced by the next one (the endpoint released every hold of the old one with it). */
    relink: () => {
      channel = [...capabilities];
      held.clear();
    },
    hold: (until: Promise<void> | null) => (gate = until),
  };
}

describe('another machine’s dashboard’s holds (P5 O7 M5c)', () => {
  const setup = (capabilities?: readonly string[]) => {
    const h = host();
    const m = machineLink(capabilities);
    const log: string[] = [];
    const holds = createDatasetHolds({
      call: h.call as never,
      log: (line) => log.push(line),
      remote: (machine) => (machine === MINI ? (m.link as never) : null),
    });
    return { h, m, log, holds };
  };

  it('takes a remote artifact’s hold on its machine, on the channel current, and a local one on this Mac’s host', async () => {
    const { h, m, holds } = setup();
    const window = new Window(20);
    const remote = await holds.hold({ artifactId: REMOTE_ID, refs: ['assets/a.json'] }, owner(window), MINI);
    expect(m.asked).toEqual([{ name: 'artifacts.holdAssets', input: { artifactId: REMOTE_ID, refs: ['assets/a.json'] }, options: { oneChannel: true } }]);
    expect(h.call).not.toHaveBeenCalled();
    expect(m.held.size).toBe(1);
    expect(remote.holdId).not.toBe([...m.held][0]); // the machine's id never reaches the window either
    const local = await holds.hold({ artifactId: ID, refs: ['assets/b.json'] }, owner(window));
    expect(h.log).toEqual(['hold assets/b.json']);
    expect(m.asked).toHaveLength(1);
    expect(await holds.release(remote, owner(window))).toEqual({ released: true });
    expect(m.held.size).toBe(0);
    expect(m.asked[1]).toMatchObject({ name: 'artifacts.releaseAssets', options: { oneChannel: true } });
    expect(await holds.release(local, owner(window))).toEqual({ released: true });
    expect(h.held.size).toBe(0);
  });

  it('releases a closed window’s remote holds on their machine', async () => {
    const { m, holds } = setup();
    const window = new Window(21);
    await holds.hold({ artifactId: REMOTE_ID, refs: ['assets/a.json'] }, owner(window), MINI);
    expect(m.held.size).toBe(1);
    window.destroy();
    await vi.waitFor(() => expect(m.held.size).toBe(0));
  });

  it('asks nothing of a channel that ended: the endpoint released its holds, and a hold answered after it is refused', async () => {
    const { m, holds } = setup();
    const window = new Window(22);
    const { holdId } = await holds.hold({ artifactId: REMOTE_ID, refs: ['assets/a.json'] }, owner(window), MINI);
    m.relink();
    m.link.call.mockClear();
    expect(await holds.release({ holdId }, owner(window))).toEqual({ released: true });
    expect(m.link.call).not.toHaveBeenCalled();
    let open!: () => void;
    m.hold(new Promise<void>((resolve) => (open = resolve)));
    const late = holds.hold({ artifactId: REMOTE_ID, refs: ['assets/b.json'] }, owner(window), MINI);
    await vi.waitFor(() => expect(m.link.call).toHaveBeenCalledTimes(1));
    m.relink();
    open();
    await expect(late).rejects.toThrow(/made again/);
    expect(m.link.call).toHaveBeenCalledTimes(1); // no release on the next channel: the hold was the ended one's
  });

  it('keeps remote holds when this Mac’s engine host goes (it held none of them)', async () => {
    const { m, holds } = setup();
    const window = new Window(23);
    const { holdId } = await holds.hold({ artifactId: REMOTE_ID, refs: ['assets/a.json'] }, owner(window), MINI);
    expect(m.held.size).toBe(1);
    holds.hostLost();
    expect(await holds.release({ holdId }, owner(window))).toEqual({ released: true });
    expect(m.held.size).toBe(0);
  });

  it('draws unheld on a machine whose endpoint holds nothing for a device (no `rl2.asset-holds`), saying so once for the machine', async () => {
    const { h, m, log, holds } = setup(['rl2.artifacts']);
    const window = new Window(24);
    const one = await holds.hold({ artifactId: REMOTE_ID, refs: ['assets/a.json'] }, owner(window), MINI);
    await holds.hold({ artifactId: REMOTE_ID, refs: ['assets/b.json'] }, owner(window), MINI);
    expect(m.link.call).not.toHaveBeenCalled();
    expect(h.call).not.toHaveBeenCalled();
    expect(log.filter((line) => line.includes('mini'))).toHaveLength(1);
    expect(log[0]).toMatch(/unheld/);
    expect(await holds.release(one, owner(window))).toEqual({ released: true });
    expect(m.link.call).not.toHaveBeenCalled();
  });

  it('refuses a remote artifact’s hold while no link or no channel reaches its machine', async () => {
    const h = host();
    const holds = createDatasetHolds({ call: h.call as never, remote: () => null });
    const refused = await holds.hold({ artifactId: REMOTE_ID, refs: ['assets/a.json'] }, owner(new Window(25)), MINI).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CommandFailure);
    expect((refused as CommandFailure).error.code).toBe('host_unavailable');
    expect(h.call).not.toHaveBeenCalled();
  });
});

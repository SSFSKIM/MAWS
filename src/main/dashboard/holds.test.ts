// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3); the ledger's E3 hold-IPC
// row): a window's holds over snapshot bytes, main's `artifacts.holdDatasets` and `artifacts.releaseDatasets`. Main takes
// the host's hold and answers an unforgeable handle bound to the asking window: another window cannot release it, and the
// window's closing, navigating or crashing releases every hold it took, released or not by its page. A hold that lands
// after its window went is released at once; the host's going takes its holds with it, so main forgets theirs.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { commands } from '@shared/ipc/schema/artifacts';
import { CommandFailure } from '../ipc/router';
import { createDatasetHolds, type HoldOwner } from './holds';

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
const owner = (window: Window) => window as unknown as HoldOwner;

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
    for (const [k, end] of (['destroyed', 'did-navigate', 'render-process-gone'] as const).entries()) {
      const window = new Window(10 + k);
      await holds.hold({ artifactId: ID, refs: ['assets/a.json'] }, owner(window));
      const { holdId } = await holds.hold({ artifactId: ID, refs: ['assets/b.json'] }, owner(window));
      expect(h.held.size).toBe(2);
      if (end === 'destroyed') window.destroy();
      else window.emit(end);
      await vi.waitFor(() => expect(h.held.size).toBe(0));
      expect(await holds.release({ holdId }, owner(window))).toEqual({ released: false });
    }
  });

  it('a navigated window holds again afresh; a hold landing after its window went is released at once and refused', async () => {
    const h = host();
    const holds = createDatasetHolds({ call: h.call as never });
    const window = new Window(3);
    await holds.hold({ artifactId: ID, refs: ['assets/a.json'] }, owner(window));
    window.emit('did-navigate');
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

// The terminal registry against `FakeRenderer` and a fake X2 bridge (C9 M3 pins): acks, dedupe and the hidden
// throttle, the claim-before-request reattach with its exact and lossy paths, checkpoint cadence, lifecycle, keys,
// links, the WebGL budget and theme pushes.
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, EventName, EventPayload, HostState, MawsBridge, PtyAttach, PtyId, PtyInfo } from '@shared/ipc/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectKeys } from '../keymap/dispatcher';
import { bindChord } from '../keymap/useKeyChord';
import { FakeRenderer } from './renderer.fake';
import type { TerminalTheme } from './renderer';
import { TerminalRegistry, type Adopting } from './registry';
import { alignReplay, explicitModes, INITIAL_STREAM } from './replay';
import { SETTINGS_DEFAULTS_V3 } from '@shared/settings/defaults';

const A = 'session-a' as AppSessionId;
const KiB = 1024;
const bytes = (text: string) => new TextEncoder().encode(text);
const filled = (length: number, char = 'x') => bytes(char.repeat(length));

const theme = (background: string): TerminalTheme => ({
  background,
  foreground: 'fg',
  cursor: 'cursor',
  cursorAccent: 'accent',
  selectionBackground: 'selection',
  ansi: Array.from({ length: 16 }, (_, i) => `ansi-${i}`),
});

type Handler = (input: unknown) => unknown;

// A handler returning this answers the command with an error, as the router or a host would.
class Failure {
  constructor(readonly code: 'host_unavailable' | 'internal' | 'timeout', readonly message: string) {}
}
const fail = (code: Failure['code'], message: string) => new Failure(code, message);

// A bridge whose commands answer from handlers (a returned promise holds the reply) and whose events the test emits.
function fakeBridge() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const calls: { name: string; input: unknown }[] = [];
  let ptys = 0;
  const handlers: Record<string, Handler> = {
    'pty.spawn': () => ({ ptyId: `pty-${++ptys}`, pid: 1000 + ptys }),
    'pty.list': () => ({ ptys: [] }),
    'pty.hostState': () => ({ state: 'ready', pid: 42, restarts: 0, revision: 1 }),
    'pty.foreground': () => ({ process: 'zsh', busy: false }),
  };
  const bridge = {
    async invoke(name: CommandName, input: unknown) {
      calls.push({ name, input });
      const handler = handlers[name];
      const value = handler ? await handler(input) : undefined;
      if (value instanceof Failure) return { ok: false, error: { code: value.code, message: value.message } };
      return { ok: true, value };
    },
    on(name: EventName, listener: (payload: unknown) => void) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
  } as unknown as MawsBridge;
  return {
    bridge,
    handlers,
    calls,
    inputs: (name: CommandName) => calls.filter((c) => c.name === name).map((c) => c.input as Record<string, unknown>),
    emit<N extends EventName>(name: N, payload: EventPayload<N>) {
      listeners.get(name)?.forEach((cb) => cb(payload));
    },
    data(ptyId: string, offset: number, data: Uint8Array<ArrayBuffer>) {
      this.emit('pty.data', { ptyId: ptyId as PtyId, offset, data });
    },
  };
}

// A deferred reply, to hold a command's answer while events arrive.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.observed = [];
  }
  static trigger() {
    for (const o of FakeResizeObserver.instances) if (o.observed.length) o.callback([], o as unknown as ResizeObserver);
  }
}

let ipc: ReturnType<typeof fakeBridge>;
let renderers: FakeRenderer[];
let runAction: ReturnType<typeof vi.fn<(id: 'tab.next' | 'tab.previous') => void>>;
let currentTheme: TerminalTheme;

// `rendererFails`: every renderer creation rejects; `rendererFailures`: only the first that many do.
function makeRegistry(options: { webglBudget?: number; rendererFails?: boolean; rendererFailures?: number } = {}) {
  let failures = options.rendererFailures ?? 0;
  return new TerminalRegistry({
    ipc: ipc.bridge,
    createRenderer: async (opts) => {
      if (options.rendererFails || failures-- > 0) throw new Error('no WebGL, no DOM: the renderer could not start');
      const r = new FakeRenderer(opts);
      renderers.push(r);
      return r;
    },
    readTheme: () => currentTheme,
    readFont: () => ({ family: 'mono', size: 13, lineHeight: 1.2 }),
    runAction,
    ...(options.webglBudget ? { webglBudget: options.webglBudget } : {}),
  });
}

const settle = () => vi.advanceTimersByTimeAsync(0);

function parent() {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

// Opens a terminal, mounts it and lets it spawn: its renderer and pty id.
async function openRunning(registry: TerminalRegistry, label = 't1') {
  const id = registry.open({ appSessionId: A, label, cwd: '/tmp/a' });
  registry.mount(id, parent());
  await settle();
  const handle = registry.get(id)!;
  return { id, renderer: handle.renderer as FakeRenderer, ptyId: handle.info.ptyId! };
}

const ptyInfo = (overrides: Partial<PtyInfo> = {}): PtyInfo => ({
  ptyId: 'pty-live' as PtyId,
  appSessionId: A,
  label: 'restored',
  pid: 777,
  cwd: '/tmp/a',
  shell: '/bin/zsh',
  cols: 100,
  rows: 30,
  spawnedAt: '2026-09-28T00:00:00.000Z',
  alive: true,
  paused: false,
  exit: null,
  offset: 132,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  FakeResizeObserver.instances = [];
  ipc = fakeBridge();
  renderers = [];
  runAction = vi.fn();
  currentTheme = theme('light-bg');
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('terminal registry acks, dedupes and throttles', () => {
  it('coalesces acks: two 20 KiB chunks give one ack after the second, a lone 20 KiB chunk is acked by the 16 ms timer', async () => {
    const registry = makeRegistry();
    const { ptyId } = await openRunning(registry);
    ipc.data(ptyId, 0, filled(20 * KiB));
    expect(ipc.inputs('pty.ack')).toEqual([]);
    ipc.data(ptyId, 20 * KiB, filled(20 * KiB));
    expect(ipc.inputs('pty.ack')).toEqual([{ ptyId, offset: 40 * KiB }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(ipc.inputs('pty.ack')).toHaveLength(1);

    ipc.data(ptyId, 40 * KiB, filled(20 * KiB));
    await vi.advanceTimersByTimeAsync(15);
    expect(ipc.inputs('pty.ack')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ipc.inputs('pty.ack')).toEqual([
      { ptyId, offset: 40 * KiB },
      { ptyId, offset: 60 * KiB },
    ]);
  });

  it('acks only what the renderer has parsed', async () => {
    const registry = makeRegistry();
    const { ptyId, renderer } = await openRunning(registry);
    renderer.autoParse = false;
    ipc.data(ptyId, 0, filled(40 * KiB));
    await vi.advanceTimersByTimeAsync(100);
    expect(ipc.inputs('pty.ack')).toEqual([]);
    renderer.parseAll();
    expect(ipc.inputs('pty.ack')).toEqual([{ ptyId, offset: 40 * KiB }]);
  });

  it('acks at most 256 KiB per 250 ms tick while hidden, and is unthrottled when visible', async () => {
    const registry = makeRegistry();
    const { id, ptyId } = await openRunning(registry);
    registry.unmount(id);
    for (let i = 0; i < 8; i++) ipc.data(ptyId, i * 128 * KiB, filled(128 * KiB)); // 1 MiB parsed while hidden
    await vi.advanceTimersByTimeAsync(249);
    expect(ipc.inputs('pty.ack')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ipc.inputs('pty.ack').map((a) => a.offset)).toEqual([256 * KiB]);
    await vi.advanceTimersByTimeAsync(250);
    expect(ipc.inputs('pty.ack').map((a) => a.offset)).toEqual([256 * KiB, 512 * KiB]);

    registry.mount(id, parent()); // shown again: what is parsed is acknowledged at once
    await settle();
    expect(ipc.inputs('pty.ack').map((a) => a.offset)).toEqual([256 * KiB, 512 * KiB, 1024 * KiB]);
    ipc.data(ptyId, 1024 * KiB, filled(1024 * KiB));
    expect(ipc.inputs('pty.ack').at(-1)!.offset).toBe(2048 * KiB);
  });

  it('checkpoints once after 500 ms of quiet, with the offset of the last parsed byte and the explicit modes', async () => {
    const registry = makeRegistry();
    const { ptyId } = await openRunning(registry);
    ipc.data(ptyId, 0, bytes('one\r\n'));
    ipc.data(ptyId, 5, bytes('two\r\n'));
    await vi.advanceTimersByTimeAsync(499);
    expect(ipc.inputs('pty.checkpoint')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ipc.inputs('pty.checkpoint')).toEqual([{ ptyId, offset: 10, state: `SERIALIZED${explicitModes(INITIAL_STREAM)}` }]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ipc.inputs('pty.checkpoint')).toHaveLength(1);
  });

  it('never checkpoints during steady output, a chunk every 100 ms for two seconds', async () => {
    const registry = makeRegistry();
    const { ptyId } = await openRunning(registry);
    for (let i = 0; i < 20; i++) {
      ipc.data(ptyId, i * 6, bytes(`line${i % 10}\n`));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(ipc.inputs('pty.checkpoint')).toEqual([]);
  });

  it('defers a checkpoint that falls due inside an escape sequence to the next chunk that ends on a boundary', async () => {
    const registry = makeRegistry();
    const { ptyId } = await openRunning(registry);
    ipc.data(ptyId, 0, bytes('\x1b[?1006h\x1b[31'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ipc.inputs('pty.checkpoint')).toEqual([]);
    ipc.data(ptyId, 12, bytes('mRED'));
    expect(ipc.inputs('pty.checkpoint')).toEqual([{ ptyId, offset: 16, state: `SERIALIZED\x1b[?1000l\x1b[?1006h\x1b[?1004l\x1b[?25h` }]);
  });

  it('takes no checkpoint while a scroll region narrower than the screen is set, and resumes once the region is full again or a resize clears it', async () => {
    const registry = makeRegistry();
    const { ptyId, renderer } = await openRunning(registry); // 80 × 24
    ipc.data(ptyId, 0, bytes('\x1b[2;5r'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ipc.inputs('pty.checkpoint')).toEqual([]);
    ipc.data(ptyId, 6, bytes('\x1b[1;24r')); // the full screen, spelled out for these 24 rows
    await vi.advanceTimersByTimeAsync(500);
    expect(ipc.inputs('pty.checkpoint').map((c) => c.offset)).toEqual([13]);
    ipc.data(ptyId, 13, bytes('\x1b[3;9r'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ipc.inputs('pty.checkpoint')).toHaveLength(1);
    renderer.fitSize = { cols: 100, rows: 30 }; // a resize puts xterm's region back to the full screen
    FakeResizeObserver.trigger();
    await vi.advanceTimersByTimeAsync(50);
    ipc.data(ptyId, 19, bytes('x'));
    await vi.advanceTimersByTimeAsync(500);
    expect(ipc.inputs('pty.checkpoint').map((c) => c.offset)).toEqual([13, 20]);
  });

  it('checkpoints every live handle at pagehide at once, and setCheckpoints(false) stops both paths', async () => {
    const registry = makeRegistry();
    const first = await openRunning(registry, 't1');
    const second = await openRunning(registry, 't2');
    ipc.data(first.ptyId, 0, bytes('a'));
    ipc.data(second.ptyId, 0, bytes('bb'));
    window.dispatchEvent(new Event('pagehide'));
    expect(ipc.inputs('pty.checkpoint').map((c) => [c.ptyId, c.offset])).toEqual([
      [first.ptyId, 1],
      [second.ptyId, 2],
    ]);

    registry.setCheckpoints(false);
    ipc.data(first.ptyId, 1, bytes('more'));
    await vi.advanceTimersByTimeAsync(1_000);
    window.dispatchEvent(new Event('pagehide'));
    expect(ipc.inputs('pty.checkpoint')).toHaveLength(2);
  });

  it('skips checkpoints for a renderer that cannot serialise', async () => {
    const registry = makeRegistry();
    const { ptyId, renderer } = await openRunning(registry);
    renderer.serialized = null;
    ipc.data(ptyId, 0, bytes('text'));
    await vi.advanceTimersByTimeAsync(1_000);
    window.dispatchEvent(new Event('pagehide'));
    expect(ipc.inputs('pty.checkpoint')).toEqual([]);
  });
});

describe('terminal registry reattaches without a gap', () => {
  // `pty.list` offers one live pty; `pty.attach` is held until the test resolves it.
  async function adoptHeld(attach: Omit<PtyAttach, 'info'>, info = ptyInfo()) {
    const registry = makeRegistry();
    ipc.handlers['pty.list'] = () => ({ ptys: [info] });
    const held = deferred<PtyAttach>();
    ipc.handlers['pty.attach'] = () => held.promise;
    const adopted = registry.adopt();
    await settle();
    expect(ipc.inputs('pty.attach')).toEqual([{ ptyId: info.ptyId }]);
    // The host emits after its snapshot and before the reply reaches the page.
    ipc.data(info.ptyId, 100, filled(32, 'd'));
    ipc.data(info.ptyId, 132, bytes('live'));
    held.resolve({ info, ...attach });
    const [id] = await adopted;
    const handle = registry.get(id!)!;
    return { registry, id: id!, handle, renderer: handle.renderer as FakeRenderer };
  }

  const replay = (length: number) => filled(length, 'r');

  it('writes the checkpoint, the replay, then only the chunks from nextOffset on: exact', async () => {
    const { handle, renderer } = await adoptHeld({ checkpoint: { offset: 0, state: 'STATE' }, replay: replay(132), replayFrom: 0, nextOffset: 132 });
    expect(renderer.writes).toEqual(['STATE', 'r'.repeat(132), 'live']);
    expect(renderer.resets).toBe(0);
    expect(renderer.resizes[0]).toEqual([100, 30]); // the pty's size, before the checkpoint is written
    expect(handle.info).toMatchObject({ reconnect: 'exact', status: 'running', pid: 777, label: 'restored', cwd: '/tmp/a' });
    await vi.advanceTimersByTimeAsync(250); // not mounted yet: hidden, so acknowledged on the 250 ms tick
    expect(ipc.inputs('pty.ack')).toEqual([{ ptyId: 'pty-live', offset: 136 }]);
    expect(ipc.inputs('pty.resize')).toEqual([]); // no repaint nudge on the exact path
  });

  it('resets, writes the aligned tail and nudges a repaint when the ring does not reach the checkpoint: lossy', async () => {
    const tail = bytes('rest of a line\r\nwhole line\r\n');
    const { handle, renderer } = await adoptHeld({ checkpoint: { offset: 0, state: 'STATE' }, replay: tail, replayFrom: 40, nextOffset: 132 });
    expect(renderer.resets).toBe(1);
    expect(renderer.writes).toEqual([new TextDecoder().decode(alignReplay(tail)), 'live']);
    expect(handle.info.reconnect).toBe('lossy');
    await vi.advanceTimersByTimeAsync(100);
    expect(ipc.inputs('pty.resize')).toEqual([
      { ptyId: 'pty-live', cols: 100, rows: 29 },
      { ptyId: 'pty-live', cols: 100, rows: 30 },
    ]);
  });

  it('is lossy with no checkpoint', async () => {
    const { handle, renderer } = await adoptHeld({ checkpoint: null, replay: bytes('x\r\ny\r\n'), replayFrom: 0, nextOffset: 132 });
    expect(renderer.resets).toBe(1);
    expect(renderer.writes[0]).toBe('y\r\n');
    expect(handle.info.reconnect).toBe('lossy');
  });

  it('holds the first chunks of a pty whose spawn reply has not arrived and delivers them after it', async () => {
    const registry = makeRegistry();
    const held = deferred<{ ptyId: string; pid: number }>();
    ipc.handlers['pty.spawn'] = () => held.promise;
    const id = registry.open({ appSessionId: A, label: 't1', cwd: '/tmp/a' });
    registry.mount(id, parent());
    await settle();
    ipc.data('pty-new', 0, bytes('prompt$ '));
    ipc.data('pty-other', 0, bytes('not ours'));
    held.resolve({ ptyId: 'pty-new', pid: 5 });
    await settle();
    const handle = registry.get(id)!;
    expect((handle.renderer as FakeRenderer).writes).toEqual(['prompt$ ']);
    expect(handle.info).toMatchObject({ ptyId: 'pty-new', pid: 5, status: 'running', reconnect: null });
  });

  it('holds an exit that overtakes the spawn reply', async () => {
    const registry = makeRegistry();
    const held = deferred<{ ptyId: string; pid: number }>();
    ipc.handlers['pty.spawn'] = () => held.promise;
    const id = registry.open({ appSessionId: A, label: 't1', cwd: '/tmp/a', command: 'exit 3' });
    registry.mount(id, parent());
    await settle();
    expect(ipc.inputs('pty.spawn')[0]).toMatchObject({ command: 'exit 3', cols: 80, rows: 24 });
    ipc.data('pty-new', 0, bytes('bye'));
    ipc.emit('pty.exit', { ptyId: 'pty-new' as PtyId, exitCode: 3, signal: null });
    held.resolve({ ptyId: 'pty-new', pid: 5 });
    await settle();
    expect(registry.get(id)!.info).toMatchObject({ status: 'exited', exit: { exitCode: 3, signal: null } });
    expect((registry.get(id)!.renderer as FakeRenderer).writes).toEqual(['bye']);
  });

  it('tells onListed each claimed handle once pty.list answers, before any attach does; release lets one go without a kill', async () => {
    const registry = makeRegistry();
    const kept = ptyInfo({ ptyId: 'pty-kept' as PtyId, label: 'terminal:kept' });
    const slow = ptyInfo({ ptyId: 'pty-slow' as PtyId, label: 'terminal:slow' });
    ipc.handlers['pty.list'] = () => ({ ptys: [kept, slow, ptyInfo({ ptyId: 'pty-other' as PtyId, appSessionId: 'diagnostics' as AppSessionId, label: 'echo' })] });
    const held = new Map([kept, slow].map((info) => [info.ptyId, deferred<PtyAttach>()]));
    ipc.handlers['pty.attach'] = (input) => held.get((input as { ptyId: PtyId }).ptyId)!.promise;
    const heard: Adopting[][] = [];
    const adopted = registry.adopt((info) => info.appSessionId === A, (adopting) => heard.push(adopting));
    await settle();
    expect(heard.map((adopting) => adopting.map(({ label }) => label))).toEqual([['terminal:kept', 'terminal:slow']]);
    const [first, second] = heard[0];
    expect(registry.get(first.id)?.info.label).toBe('terminal:kept'); // the handle exists before its attach answers
    registry.release(second.id);
    expect(registry.get(second.id)).toBeUndefined();
    expect(ipc.inputs('pty.kill')).toEqual([]);
    held.get(kept.ptyId)!.resolve({ info: kept, checkpoint: null, replay: new Uint8Array(0), replayFrom: 0, nextOffset: 0 });
    held.get(slow.ptyId)!.resolve({ info: slow, checkpoint: null, replay: new Uint8Array(0), replayFrom: 0, nextOffset: 0 });
    await expect(first.attached).resolves.toBe(first.id);
    await expect(second.attached).resolves.toBeNull(); // released before its attach answered: nothing restored
    await expect(adopted).resolves.toEqual([first.id]);
  });

  it('adopts only what the page accepts, and a dead pty as exited with its screen', async () => {
    const registry = makeRegistry();
    const dead = ptyInfo({ ptyId: 'pty-dead' as PtyId, label: 'dead', alive: false, exit: { exitCode: 1, signal: null } });
    const other = ptyInfo({ ptyId: 'pty-echo' as PtyId, appSessionId: 'diagnostics' as AppSessionId, label: 'echo' });
    ipc.handlers['pty.list'] = () => ({ ptys: [dead, other] });
    ipc.handlers['pty.attach'] = (input) => ({
      info: dead,
      checkpoint: { offset: 10, state: 'DEAD SCREEN' },
      replay: new Uint8Array(0),
      replayFrom: 10,
      nextOffset: 10,
      ...(input as { ptyId: string }),
    });
    const ids = await registry.adopt((info) => info.appSessionId === A);
    expect(ids).toHaveLength(1);
    expect(ipc.inputs('pty.attach')).toEqual([{ ptyId: 'pty-dead' }]);
    const handle = registry.get(ids[0]!)!;
    expect(handle.info).toMatchObject({ status: 'exited', exit: { exitCode: 1, signal: null }, reconnect: 'exact' });
    expect((handle.renderer as FakeRenderer).writes).toEqual(['DEAD SCREEN']);
  });

  it('drops a chunk below nextOffset after the reattach', async () => {
    const { renderer } = await adoptHeld({ checkpoint: { offset: 132, state: 'S' }, replay: new Uint8Array(0), replayFrom: 132, nextOffset: 132 });
    ipc.data('pty-live', 120, bytes('old'));
    ipc.data('pty-live', 136, bytes('new'));
    expect(renderer.writes).toEqual(['S', 'live', 'new']);
  });
});

describe('terminal registry lifecycle', () => {
  it('creates every container with the terminal key-sink marker and mounts the renderer inside it', async () => {
    const registry = makeRegistry();
    const { id, renderer } = await openRunning(registry);
    const container = registry.get(id)!.container;
    expect(container.dataset.keySink).toBe('terminal');
    expect(container.contains(renderer.element)).toBe(true);
  });

  it('retries a mount without a size on the next resize callback instead of spawning at a default size', async () => {
    const created = deferred<void>();
    const sized = new TerminalRegistry({
      ipc: ipc.bridge,
      createRenderer: async (opts) => {
        const r = new FakeRenderer(opts);
        r.fitSize = null;
        renderers.push(r);
        created.resolve();
        return r;
      },
      readTheme: () => currentTheme,
      readFont: () => ({ family: 'mono', size: 13, lineHeight: 1.2 }),
      runAction,
    });
    const id = sized.open({ appSessionId: A, label: 't1', cwd: '/tmp/a' });
    sized.mount(id, parent());
    await created.promise;
    await settle();
    expect(ipc.inputs('pty.spawn')).toEqual([]);
    renderers[0]!.fitSize = { cols: 120, rows: 40 };
    FakeResizeObserver.trigger();
    await vi.advanceTimersByTimeAsync(49);
    expect(ipc.inputs('pty.spawn')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ipc.inputs('pty.spawn')).toEqual([{ appSessionId: A, label: 't1', cwd: '/tmp/a', cols: 120, rows: 40 }]);
  });

  it('resizes the renderer and the pty once per settled size change', async () => {
    const registry = makeRegistry();
    const { renderer, ptyId } = await openRunning(registry);
    renderer.fitSize = { cols: 90, rows: 24 };
    FakeResizeObserver.trigger();
    await vi.advanceTimersByTimeAsync(20);
    renderer.fitSize = { cols: 100, rows: 30 };
    FakeResizeObserver.trigger();
    await vi.advanceTimersByTimeAsync(50);
    FakeResizeObserver.trigger(); // same size again
    await vi.advanceTimersByTimeAsync(50);
    expect(ipc.inputs('pty.resize')).toEqual([{ ptyId, cols: 100, rows: 30 }]);
    expect(renderer.resizes.at(-1)).toEqual([100, 30]);
  });

  it('forwards input, follows the title and focuses on request', async () => {
    const registry = makeRegistry();
    const id = registry.open({ appSessionId: A, label: 't1', cwd: '/tmp/a' });
    registry.mount(id, parent(), { focus: true });
    await settle();
    const handle = registry.get(id)!;
    const renderer = handle.renderer as FakeRenderer;
    expect(renderer.focused).toBe(true);
    renderer.type('ls\r');
    expect(ipc.inputs('pty.write')).toEqual([{ ptyId: handle.info.ptyId, data: 'ls\r' }]);
    renderer.setTitle('vim');
    expect(registry.get(id)!.info.title).toBe('vim');
  });

  it('marks lost on an exit without code or signal and exited on a real one', async () => {
    const registry = makeRegistry();
    const first = await openRunning(registry, 't1');
    const second = await openRunning(registry, 't2');
    ipc.emit('pty.exit', { ptyId: first.ptyId, exitCode: null, signal: null });
    ipc.emit('pty.exit', { ptyId: second.ptyId, exitCode: 0, signal: null });
    expect(registry.get(first.id)!.info).toMatchObject({ status: 'lost', exit: { exitCode: null, signal: null } });
    expect(registry.get(second.id)!.info).toMatchObject({ status: 'exited', exit: { exitCode: 0, signal: null } });
  });

  it('marks every live handle lost once on a host crash, idempotent with the supervisor exit events', async () => {
    const registry = makeRegistry();
    const live = await openRunning(registry, 't1');
    const done = await openRunning(registry, 't2');
    ipc.emit('pty.exit', { ptyId: done.ptyId, exitCode: 0, signal: null });
    const statuses: string[] = [];
    registry.subscribe((infos) => statuses.push(infos.map((i) => i.status).join(',')));
    const crashed: HostState = { state: 'crashed', pid: null, restarts: 1, revision: 2 };
    ipc.emit('pty.hostState', crashed);
    ipc.emit('pty.exit', { ptyId: live.ptyId, exitCode: null, signal: null });
    ipc.emit('pty.exit', { ptyId: done.ptyId, exitCode: null, signal: null });
    ipc.emit('pty.hostState', { ...crashed, state: 'restarting', revision: 3 });
    expect(registry.get(live.id)!.info.status).toBe('lost');
    expect(registry.get(done.id)!.info).toMatchObject({ status: 'exited', exit: { exitCode: 0, signal: null } });
    expect(statuses.filter((s) => s.startsWith('lost'))).toHaveLength(statuses.length);
    expect(new Set(statuses.map((s) => s.split(',')[0]))).toEqual(new Set(['lost']));
    expect(registry.host()).toMatchObject({ state: 'restarting' });
    // The lost handle no longer receives or acknowledges anything under its old id.
    ipc.data(live.ptyId, 0, bytes('late'));
    expect(live.renderer.writes).toEqual([]);
  });

  it('respawns a lost terminal with its cwd and label in the same handle, the old screen cleared', async () => {
    const registry = makeRegistry();
    const { id, ptyId, renderer } = await openRunning(registry);
    ipc.emit('pty.exit', { ptyId, exitCode: null, signal: null });
    await registry.respawn(id);
    expect(ipc.inputs('pty.spawn').at(-1)).toEqual({ appSessionId: A, label: 't1', cwd: '/tmp/a', cols: 80, rows: 24 });
    expect(renderer.resets).toBe(1);
    const info = registry.get(id)!.info;
    expect(info).toMatchObject({ status: 'running', exit: null, ptyId: 'pty-2' });
    expect(registry.get(id)!.renderer).toBe(renderer);
    ipc.data('pty-2', 0, bytes('fresh'));
    ipc.data(ptyId, 0, bytes('stale'));
    expect(renderer.writes).toEqual(['fresh']);
  });

  it('closes by killing the pty, then disposes the handle', async () => {
    const registry = makeRegistry();
    const { id, ptyId, renderer } = await openRunning(registry);
    await registry.close(id);
    expect(ipc.inputs('pty.kill')).toEqual([{ ptyId }]);
    expect(renderer.disposed).toBe(true);
    expect(registry.get(id)).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it('keeps a terminal whose pty.kill failed, and rethrows so the tool can say so', async () => {
    const registry = makeRegistry();
    const { id, renderer } = await openRunning(registry);
    ipc.handlers['pty.kill'] = () => fail('timeout', 'pty-host did not answer pty.kill within 10 s');
    await expect(registry.close(id)).rejects.toThrow('did not answer pty.kill');
    expect(registry.get(id)?.info.status).toBe('running');
    expect(renderer.disposed).toBe(false);
    renderer.type('still here\r');
    expect(ipc.inputs('pty.write').at(-1)).toMatchObject({ data: 'still here\r' });
  });

  it('disposes when pty.kill fails because the pty or its host is already gone', async () => {
    const registry = makeRegistry();
    const unknown = await openRunning(registry, 't1');
    const unavailable = await openRunning(registry, 't2');
    ipc.handlers['pty.kill'] = (input) =>
      (input as { ptyId: string }).ptyId === unknown.ptyId ? fail('internal', 'unknown pty') : fail('host_unavailable', 'pty-host is restarting; cannot answer pty.kill');
    await registry.close(unknown.id);
    await registry.close(unavailable.id);
    expect(registry.list()).toEqual([]);
    expect([unknown.renderer.disposed, unavailable.renderer.disposed]).toEqual([true, true]);
  });

  it('shows a terminal whose shell could not spawn as exited with the reason', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = makeRegistry();
    ipc.handlers['pty.spawn'] = () => fail('internal', 'spawn /bin/zsh ENOENT');
    const id = registry.open({ appSessionId: A, label: 't1', cwd: '/tmp/a' });
    registry.mount(id, parent());
    await settle();
    expect(registry.get(id)!.info).toMatchObject({ status: 'exited', exit: null, ptyId: null, error: 'the shell could not start: spawn /bin/zsh ENOENT' });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('rejects foreground when the host cannot answer, so the tool fails closed and asks', async () => {
    const registry = makeRegistry();
    const { id } = await openRunning(registry);
    ipc.handlers['pty.foreground'] = () => fail('host_unavailable', 'pty-host is crashed; cannot answer pty.foreground');
    await expect(registry.foreground(id)).rejects.toThrow('cannot answer pty.foreground');
  });

  it('shows a terminal whose renderer could not start as exited with the reason, and spawns nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = makeRegistry({ rendererFails: true });
    const id = registry.open({ appSessionId: A, label: 't1', cwd: '/tmp/a' });
    registry.mount(id, parent());
    await settle();
    expect(registry.get(id)!.info).toMatchObject({ status: 'exited', exit: null, error: expect.stringContaining('renderer could not start') });
    expect(registry.get(id)!.renderer).toBeNull();
    expect(ipc.inputs('pty.spawn')).toEqual([]);
    expect(logged).toHaveBeenCalledWith('[terminal] renderer creation failed', expect.any(Error));
  });

  it('recovers a terminal whose renderer failed once: respawn creates the renderer again, then spawns', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = makeRegistry({ rendererFailures: 1 });
    const id = registry.open({ appSessionId: A, label: 't1', cwd: '/tmp/a' });
    registry.mount(id, parent());
    await settle();
    expect(registry.get(id)!.info).toMatchObject({ status: 'exited', error: expect.stringContaining('renderer could not start') });
    await registry.respawn(id);
    const handle = registry.get(id)!;
    expect(handle.renderer).toBeInstanceOf(FakeRenderer);
    expect(handle.container.contains(handle.renderer!.element)).toBe(true);
    expect(handle.info).toMatchObject({ status: 'running', error: null, ptyId: 'pty-1', acceleration: 'webgl' });
    expect(ipc.inputs('pty.spawn')).toEqual([{ appSessionId: A, label: 't1', cwd: '/tmp/a', cols: 80, rows: 24 }]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('keeps a terminal whose renderer fails again exited, with the error, and rejects respawn', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = makeRegistry({ rendererFails: true });
    const id = registry.open({ appSessionId: A, label: 't1', cwd: '/tmp/a' });
    registry.mount(id, parent());
    await settle();
    await expect(registry.respawn(id)).rejects.toThrow('the terminal renderer could not start');
    expect(registry.get(id)!.info).toMatchObject({ status: 'exited', exit: null, ptyId: null, error: expect.stringContaining('renderer could not start') });
    expect(registry.get(id)!.renderer).toBeNull();
    expect(ipc.inputs('pty.spawn')).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it('reports an adopted pty whose renderer could not start, releases its claim and leaves the pty running', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = makeRegistry({ rendererFails: true });
    ipc.handlers['pty.list'] = () => ({ ptys: [ptyInfo()] });
    ipc.handlers['pty.attach'] = () => ({ info: ptyInfo(), checkpoint: null, replay: new Uint8Array(0), replayFrom: 0, nextOffset: 132 });
    const ids = await registry.adopt();
    expect(ids).toHaveLength(1);
    const handle = registry.get(ids[0]!)!;
    expect(handle.renderer).toBeNull();
    expect(handle.info).toMatchObject({ ptyId: 'pty-live', status: 'running', error: expect.stringContaining('renderer could not start') });
    expect(ipc.inputs('pty.kill')).toEqual([]);
    ipc.data('pty-live', 132, bytes('ignored')); // released: nothing is held or written for it
    expect(ipc.inputs('pty.ack')).toEqual([]);
    await expect(registry.adopt()).resolves.toEqual([]); // still known: not adopted twice
    await registry.close(ids[0]!); // and closable: the pty is killed
    expect(ipc.inputs('pty.kill')).toEqual([{ ptyId: 'pty-live' }]);
    expect(registry.list()).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('asks the host what runs in the foreground', async () => {
    const registry = makeRegistry();
    const { id, ptyId } = await openRunning(registry);
    ipc.handlers['pty.foreground'] = () => ({ process: 'sleep', busy: true });
    await expect(registry.foreground(id)).resolves.toEqual({ process: 'sleep', busy: true });
    expect(ipc.inputs('pty.foreground')).toEqual([{ ptyId }]);
  });
});

describe('terminal key filter', () => {
  it('installs the filter: ⌃Tab keydown runs tab.next once and stays with the app, ordinary keys go to the pty', async () => {
    const registry = makeRegistry();
    const { renderer } = await openRunning(registry);
    expect(renderer.key('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true })).toBe(false);
    expect(renderer.key('keyup', { key: 'Tab', code: 'Tab', ctrlKey: true })).toBe(false);
    expect(runAction.mock.calls).toEqual([['tab.next']]);
    expect(renderer.key('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(runAction.mock.calls).toEqual([['tab.next'], ['tab.previous']]);
    expect(renderer.key('keydown', { key: 'Enter', code: 'Enter' })).toBe(true);
    expect(renderer.key('keydown', { key: 'k', code: 'KeyK', metaKey: true })).toBe(false);
    expect(runAction).toHaveBeenCalledTimes(2);
  });
});

// The marker contract with C5's dispatcher (wave-2 ledger, keymap dispatcher row), isolated from the dispatcher's other
// refusals: the terminal sits inside the element a pane-scoped binding answers for (a docked card's pane, or a panel
// that hosts both), and the key comes from a focused element that is neither text entry nor a button, so only the
// container's `data-key-sink` stands between a shell's Enter and the request's accept.
describe('terminal key-sink marker', () => {
  it('keeps Enter and Escape inside a terminal from a pane-scoped binding around it', async () => {
    const registry = makeRegistry();
    const pane = parent();
    const id = registry.open({ appSessionId: A, label: 't1', cwd: '/tmp/a' });
    registry.mount(id, pane);
    await settle();
    const focusable = registry.get(id)!.renderer!.element;
    focusable.tabIndex = 0;
    const fired: string[] = [];
    const within = { current: pane };
    const offs = [
      bindChord({ id: 'request.accept', within, run: () => fired.push('accept') }),
      bindChord({ id: 'request.decline', within, run: () => fired.push('decline') }),
      connectKeys(window, () => ({})),
    ];
    const press = (key: string) => {
      focusable.focus();
      focusable.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
    };
    try {
      press('Enter');
      press('Escape');
      expect(fired).toEqual([]);
      // Control: the same element without the marker is the binding's, so the marker is what refused above.
      delete registry.get(id)!.container.dataset.keySink;
      press('Enter');
      expect(fired).toEqual(['accept']);
    } finally {
      offs.forEach((off) => off());
    }
  });
});

describe('terminal registry links', () => {
  it('opens a link through pty.openLink on a ⌘-click and does nothing on a plain click', async () => {
    const registry = makeRegistry();
    const { renderer } = await openRunning(registry);
    renderer.clickLink('https://example.com');
    expect(ipc.inputs('pty.openLink')).toEqual([]);
    renderer.clickLink('https://example.com', { metaKey: true });
    expect(ipc.inputs('pty.openLink')).toEqual([{ url: 'https://example.com' }]);
  });

  it('honours a held ⌘ when the activating event does not carry it, until ⌘ is released or the window blurs', async () => {
    const registry = makeRegistry();
    const { renderer } = await openRunning(registry);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }));
    renderer.clickLink('https://example.org');
    expect(ipc.inputs('pty.openLink')).toEqual([{ url: 'https://example.org' }]);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }));
    renderer.clickLink('https://example.org');
    expect(ipc.inputs('pty.openLink')).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }));
    window.dispatchEvent(new Event('blur'));
    renderer.clickLink('https://example.org');
    expect(ipc.inputs('pty.openLink')).toHaveLength(1);
  });
});

describe('webgl budget', () => {
  it('gives WebGL to visible terminals up to the budget; the next shown after one hides takes it', async () => {
    const registry = makeRegistry({ webglBudget: 2 });
    const a = await openRunning(registry, 'a');
    const b = await openRunning(registry, 'b');
    const c = await openRunning(registry, 'c');
    expect([a, b, c].map((t) => registry.get(t.id)!.info.acceleration)).toEqual(['webgl', 'webgl', 'dom']);
    expect(c.renderer.acceleration).toBe('dom');
    registry.unmount(a.id);
    expect(a.renderer.acceleration).toBe('dom'); // hiding releases the context
    registry.unmount(c.id);
    registry.mount(c.id, parent());
    await settle();
    expect(registry.get(c.id)!.info.acceleration).toBe('webgl');
    registry.mount(a.id, parent());
    await settle();
    expect(registry.get(a.id)!.info.acceleration).toBe('dom'); // b and c hold the two
  });

  it('releases on hide and reacquires on show, and a lost context stays on the DOM renderer until the next show', async () => {
    const registry = makeRegistry();
    const { id, renderer } = await openRunning(registry);
    expect(registry.get(id)!.info).toMatchObject({ acceleration: 'webgl', visible: true });
    registry.unmount(id);
    expect(registry.get(id)!.info).toMatchObject({ acceleration: 'dom', visible: false });
    registry.mount(id, parent());
    await settle();
    expect(registry.get(id)!.info.acceleration).toBe('webgl');
    renderer.simulateContextLoss();
    expect(registry.get(id)!.info.acceleration).toBe('dom');
    FakeResizeObserver.trigger();
    await vi.advanceTimersByTimeAsync(100);
    expect(registry.get(id)!.info.acceleration).toBe('dom');
    registry.unmount(id);
    registry.mount(id, parent());
    await settle();
    expect(registry.get(id)!.info.acceleration).toBe('webgl');
  });
});

describe('terminal theme from tokens', () => {
  it('rebuilds the theme on settings.changed and pushes it to every handle, hidden ones included', async () => {
    const registry = makeRegistry();
    const shown = await openRunning(registry, 'shown');
    const hidden = await openRunning(registry, 'hidden');
    registry.unmount(hidden.id);
    expect(shown.renderer.options.theme.background).toBe('light-bg');
    currentTheme = theme('dark-bg');
    ipc.emit('settings.changed', { settings: { ...SETTINGS_DEFAULTS_V3, theme: 'dark' }, resolvedTheme: 'dark' });
    expect(shown.renderer.theme.background).toBe('dark-bg');
    expect(hidden.renderer.theme.background).toBe('dark-bg');
  });

  it('also follows the document theme attribute, which the page sets after settings.changed', async () => {
    const registry = makeRegistry();
    const { renderer } = await openRunning(registry);
    currentTheme = theme('dark-bg');
    document.documentElement.dataset.theme = 'dark';
    await vi.waitFor(() => expect(renderer.theme.background).toBe('dark-bg'));
    delete document.documentElement.dataset.theme;
  });

  it('creates new terminals with the current theme', async () => {
    const registry = makeRegistry();
    currentTheme = theme('dark-bg');
    const { renderer } = await openRunning(registry);
    expect(renderer.options.theme.background).toBe('dark-bg');
    expect(renderer.options.webgl).toBe(true);
  });
});

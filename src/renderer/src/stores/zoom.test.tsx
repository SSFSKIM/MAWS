// UX wave U6b-5b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, M2; decisions 29 and 37; card K3): the
// window's side of the zoom. The factor it reads at start and follows, the three handlers by the factor, the root's
// `--app-zoom`, and the line that says the size after each act, against the real notices store and the real toast host.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import { ToastHost } from '../app/ToastHost';
import { isActionEnabled, runAction } from '../keymap/actions-runtime';
import { useNotices } from './notices';
import { connectZoom, useZoom, ZOOM_LINE_MS } from './zoom';

type Answer = { ok: true; value: { factor: number } } | { ok: false; error: { code: string; message: string } };

// A bridge whose `layout.zoom` answers as the test says, with `layout.zoomChanged` reachable.
function fakeBridge(current = 1) {
  const listeners = new Set<(payload: EventPayload<'layout.zoomChanged'>) => void>();
  const invoked: unknown[] = [];
  let answer: (to: string) => Answer | Promise<Answer> = (to) => ({ ok: true, value: { factor: to === 'current' ? current : 1 } });
  const bridge = {
    invoke: async (name: string, input: { to: string }) => {
      invoked.push([name, input]);
      return answer(input.to);
    },
    on: (name: string, listener: (payload: EventPayload<'layout.zoomChanged'>) => void) => {
      if (name !== 'layout.zoomChanged') return () => {};
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    pathForFile: () => '',
  } as unknown as MawsBridge;
  return {
    bridge,
    invoked,
    answer: (next: typeof answer) => void (answer = next),
    changed: (factor: number) => act(() => listeners.forEach((listener) => listener({ factor }))),
    listeners,
  };
}

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
const lines = () => useNotices.getState().notices.filter((notice) => notice.kind === 'toast');
const enabled = () => ({ in: isActionEnabled('zoom.in'), out: isActionEnabled('zoom.out'), reset: isActionEnabled('zoom.reset') });
const rootZoom = () => document.documentElement.style.getPropertyValue('--app-zoom');

let off: (() => void) | null = null;
const connect = async (f: ReturnType<typeof fakeBridge>) => {
  off = connectZoom(f.bridge);
  await settle();
};

beforeEach(() => {
  useNotices.setState({ notices: [] });
  useZoom.setState({ factor: 1 });
  document.documentElement.style.removeProperty('--app-zoom');
});
afterEach(() => {
  off?.();
  off = null;
  cleanup();
  vi.useRealTimers();
});

describe('connectZoom: the factor', () => {
  it('reads the factor at start, sets --app-zoom on the root, and shows no line for it', async () => {
    const f = fakeBridge(1.25);
    await connect(f);
    expect(f.invoked).toEqual([['layout.zoom', { to: 'current' }]]);
    expect(useZoom.getState().factor).toBe(1.25);
    expect(rootZoom()).toBe('1.25');
    expect(lines()).toEqual([]);
    f.changed(1.5); // the control: a change after it does show one
    expect(lines().map((line) => line.text)).toEqual(['Zoom 150 %']);
    expect(rootZoom()).toBe('1.5');
  });

  // the reply to the startup read can arrive after a change was heard; the event is the newer word, so it stands (the
  // case above is the control: with no event first, the reply is applied)
  it('keeps a change heard before the startup read answers, the late reply ignored', async () => {
    const f = fakeBridge();
    let reply!: (answer: Answer) => void;
    f.answer(() => new Promise<Answer>((resolve) => (reply = resolve)));
    off = connectZoom(f.bridge);
    f.changed(1.5);
    reply({ ok: true, value: { factor: 1.25 } });
    await settle();
    expect(useZoom.getState().factor).toBe(1.5);
    expect(rootZoom()).toBe('1.5');
  });

  it('registers Zoom In below 200 %, Zoom Out above 50 % and Actual Size away from 100 %', async () => {
    const f = fakeBridge(1);
    await connect(f);
    expect(enabled()).toEqual({ in: true, out: true, reset: false });
    f.changed(2);
    expect(enabled()).toEqual({ in: false, out: true, reset: true });
    f.changed(0.5);
    expect(enabled()).toEqual({ in: true, out: false, reset: true });
    f.changed(1);
    expect(enabled()).toEqual({ in: true, out: true, reset: false });
    off!();
    off = null;
    expect(enabled()).toEqual({ in: false, out: false, reset: false });
  });

  it('runs each act as main’s command, and a command that answers an error changes nothing and shows no line', async () => {
    const f = fakeBridge(1.25);
    await connect(f);
    runAction('zoom.in');
    runAction('zoom.out');
    runAction('zoom.reset');
    await settle();
    expect(f.invoked.slice(1)).toEqual([['layout.zoom', { to: 'in' }], ['layout.zoom', { to: 'out' }], ['layout.zoom', { to: 'actual' }]]);
    expect(lines()).toEqual([]); // main's answers move nothing: the event does
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.answer(() => ({ ok: false, error: { code: 'internal', message: 'EIO: i/o error, write' } }));
    runAction('zoom.in');
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(useZoom.getState().factor).toBe(1.25);
    expect(lines()).toEqual([]);
  });
});

describe('connectZoom: the line (card K3)', () => {
  it('says the size reached as a whole percent, at the info level, with no action and no dismiss, for ZOOM_LINE_MS', async () => {
    const f = fakeBridge(1);
    await connect(f);
    f.changed(1.25);
    expect(lines()).toEqual([expect.objectContaining({ level: 'info', text: 'Zoom 125 %', actions: [], dismissible: false, durationMs: ZOOM_LINE_MS })]);
    expect(ZOOM_LINE_MS).toBe(1_500);
    f.changed(0.67);
    expect(lines().map((line) => line.text)).toEqual(['Zoom 67 %']);
    f.changed(1);
    expect(lines().map((line) => line.text)).toEqual(['Zoom 100 %']);
  });

  it('takes the line away when the next act shows its own: one line at a time', async () => {
    const f = fakeBridge(1);
    await connect(f);
    f.changed(1.1);
    const first = lines()[0]!;
    expect(lines()).toEqual([first]); // the control: before the second event the same read finds the first
    f.changed(1.25);
    expect(lines().map((line) => line.text)).toEqual(['Zoom 125 %']);
    expect(lines()[0]!.id).not.toBe(first.id);
  });

  it('is drawn by the toast host, said to a screen reader, and gone just after its time and not before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = fakeBridge(1);
    render(<ToastHost />);
    await connect(f);
    f.changed(1.25);
    await act(async () => void vi.advanceTimersByTime(50)); // the host announces on its next frame
    const spoken = [...document.querySelectorAll('[role="status"][aria-live]')].filter((element) => element.getAttribute('aria-live') !== 'off');
    expect(spoken.map((element) => element.textContent).join(' ')).toContain('Zoom 125 %');
    await act(async () => void vi.advanceTimersByTime(ZOOM_LINE_MS - 250));
    expect(lines().map((line) => line.text)).toEqual(['Zoom 125 %']);
    await act(async () => void vi.advanceTimersByTime(400));
    expect(lines()).toEqual([]);
  });
});

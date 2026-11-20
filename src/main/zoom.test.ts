// UX wave U6b-5b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, M2; S3; decisions 23 to 29 and 34): the
// window's zoom in main. The steps and the stored key's reading, the command's order, a write that fails on the real
// layout store, the factor a window is made at, and the two placements whose numbers this module computes (decision 27's
// rectangle, the traffic lights), each pinned by what the Mac recorded today (spikes/zoom-probe/FINDINGS.md).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';
import { LayoutFileStore } from './layout/store';
import { nextFactor, openAt, readFactor, startZoom, toPoints, trafficLightsAt, zoomOf, type ZoomWindow } from './zoom';

vi.mock('./ipc/router', () => ({ registerMainHandler: () => {} })); // the store module's own handlers, unused here

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-zoom-'));
  file = join(dir, 'layout.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('nextFactor', () => {
  // each step against the in-app browser's presets, a fixed table: from, in, out
  it.each([
    [0.5, 0.67, 0.5],
    [0.67, 0.75, 0.5],
    [0.75, 0.8, 0.67],
    [0.8, 0.9, 0.75],
    [0.9, 1, 0.8],
    [1, 1.1, 0.9],
    [1.1, 1.25, 1],
    [1.25, 1.5, 1.1],
    [1.5, 1.75, 1.25],
    [1.75, 2, 1.5],
    [2, 2, 1.75],
  ])('from %s steps in to %s and out to %s, between 50 % and 200 %', (from, up, down) => {
    expect(nextFactor(from, 'in')).toBe(up);
    expect(nextFactor(from, 'out')).toBe(down);
  });

  it('holds at the ends; actual is 1; current changes nothing', () => {
    expect(nextFactor(2, 'in')).toBe(2);
    expect(nextFactor(0.5, 'out')).toBe(0.5);
    for (const factor of [0.5, 1.25, 2]) expect(nextFactor(factor, 'actual')).toBe(1);
    for (const factor of [0.5, 1, 1.3, 2]) expect(nextFactor(factor, 'current')).toBe(factor);
  });
});

describe('readFactor', () => {
  it('reads a stored factor, and 1 for an absent or invalid value', () => {
    expect(readFactor({ version: 1, factor: 1.25 })).toBe(1.25);
    for (const stored of [null, undefined, 'big', { version: 2, factor: 1.25 }, { version: 1, factor: 4 }, { version: 1, factor: 1.25, by: 'x' }]) {
      expect(readFactor(stored), JSON.stringify(stored)).toBe(1);
    }
  });
});

// Decision 27: each edge times the factor and rounded to a point, the size the difference, so two rectangles that touch
// in CSS pixels touch in points
describe('toPoints', () => {
  // the pane's rectangle in CSS pixels as main received it on the Mac, and the view's bounds that should have followed
  it.each([
    [0.5, { x: 1173, y: 141, width: 1380, height: 1492 }, { x: 587, y: 71, width: 690, height: 746 }],
    [0.8, { x: 789, y: 140, width: 804, height: 878 }, { x: 631, y: 112, width: 643, height: 702 }],
    [1.25, { x: 415, y: 158, width: 602, height: 491 }, { x: 519, y: 198, width: 752, height: 613 }],
    [2, { x: 29, y: 203, width: 604, height: 200 }, { x: 58, y: 406, width: 1208, height: 400 }],
  ])('at %s places the Mac’s pane edge by edge', (factor, pane, points) => {
    expect(toPoints(pane, factor)).toEqual(points);
  });

  it('keeps two touching rectangles touching, and is the rectangle itself at 1', () => {
    const left = toPoints({ x: 0, y: 0, width: 333, height: 10 }, 1.25);
    const right = toPoints({ x: 333, y: 0, width: 333, height: 10 }, 1.25);
    expect(left.x + left.width).toBe(right.x);
    expect(toPoints({ x: 415, y: 158, width: 602, height: 491 }, 1)).toEqual({ x: 415, y: 158, width: 602, height: 491 });
  });
});

// Placement 5: the lights centred in the toolbar's 44 CSS pixels at every factor; at 1 where they stand today
describe('trafficLightsAt', () => {
  it('is { x: 16, y: 15 } at 1', () => {
    expect(trafficLightsAt(1)).toEqual({ x: 16, y: 15 });
  });

  // the toolbar's height in points as the Mac measured it; the buttons are 14 points high (macOS's standard)
  it.each([
    [0.5, 22],
    [0.8, 35.1953125],
    [1.25, 55],
    [2, 88],
  ])('at %s centres the buttons in a toolbar of %s points, within a point’s rounding', (factor, toolbarPt) => {
    const { x, y } = trafficLightsAt(factor);
    expect(x).toBe(16);
    expect(Math.abs(y + 7 - toolbarPt / 2)).toBeLessThanOrEqual(0.5);
  });
});

// ---- the command ---------------------------------------------------------------------------------------------------------

type Calls = string[];
class FakeWindow implements ZoomWindow {
  destroyed = false;
  readonly page: { setZoomFactor(factor: number): void; isDestroyed(): boolean };
  readonly webContents: ZoomWindow['webContents'];
  readonly contentView: { children: { webContents?: unknown }[] } = { children: [] };
  lights: { x: number; y: number } | null = null;
  constructor(
    readonly name: string,
    private readonly calls: Calls,
  ) {
    this.page = { setZoomFactor: (factor) => void calls.push(`${name} zoom ${factor}`), isDestroyed: () => false };
    this.webContents = this.page as unknown as ZoomWindow['webContents'];
  }
  isDestroyed = () => this.destroyed;
  setWindowButtonPosition(position: { x: number; y: number }) {
    this.lights = position;
    this.calls.push(`${this.name} lights ${position.y}`);
  }
}

function harness({ layout = new LayoutFileStore(file) }: { layout?: LayoutFileStore } = {}) {
  const calls: Calls = [];
  const windows = [new FakeWindow('w1', calls), new FakeWindow('w2', calls)];
  const handlers = new Map<string, (input: unknown) => unknown>();
  startZoom({
    layout,
    windows: () => windows,
    placeAgain: (win) => void calls.push(`${(win as FakeWindow).name} placed`),
    emit: (name, payload) => void calls.push(`emit ${name} ${payload.factor}`),
    register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
  });
  const zoom = (to: 'in' | 'out' | 'actual' | 'current') => handlers.get('layout.zoom')!({ to }) as { factor: number };
  return { layout, windows, calls, zoom };
}

// A layout store whose writer fails the next `fails` writes (finding 7: the real store, a writer the test gives it).
function failingStore() {
  const writer = { fails: 0 };
  const layout = new LayoutFileStore(file, (target, text) => {
    if (writer.fails > 0) {
      writer.fails--;
      throw Object.assign(new Error('EIO: i/o error, write'), { code: 'EIO' });
    }
    atomicWriteFileSync(target, text);
  });
  return { writer, layout };
}
const onDisk = () => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('layout.zoom (S3)', () => {
  it('publishes a change and removes the key at 100 %', () => {
    const h = harness();
    expect(h.zoom('in')).toEqual({ factor: 1.1 });
    expect(h.zoom('in')).toEqual({ factor: 1.25 });
    expect(onDisk()['window.zoom']).toEqual({ version: 1, factor: 1.25 }); // the control: the same read finds the key
    expect(h.zoom('actual')).toEqual({ factor: 1 });
    expect(h.layout.get('window.zoom')).toBeNull();
    expect('window.zoom' in onDisk()).toBe(false);
  });

  it('applies a change in S3’s order to every window, and a press that changes nothing does nothing', () => {
    const h = harness();
    h.zoom('out');
    expect(h.calls).toEqual(['w1 zoom 0.9', 'w2 zoom 0.9', 'w1 lights 13', 'w1 placed', 'w2 lights 13', 'w2 placed', 'emit layout.zoomChanged 0.9']);
    expect(h.windows.map((w) => w.lights)).toEqual([trafficLightsAt(0.9), trafficLightsAt(0.9)]);
    h.calls.length = 0;
    expect(h.zoom('current')).toEqual({ factor: 0.9 });
    expect(h.zoom('actual')).toEqual({ factor: 1 });
    expect(h.zoom('actual')).toEqual({ factor: 1 });
    expect(h.calls.filter((call) => call.startsWith('emit'))).toEqual(['emit layout.zoomChanged 1']);
  });

  // placement 5 at the native call: every window's buttons centred in the toolbar at the factor reached
  it('hands every window’s setWindowButtonPosition { x: 16, y: round(22 × factor − 7) } at 0.8, 0.5, 1.25 and 2', () => {
    const h = harness();
    const lights = () => h.windows.map((win) => win.lights);
    const steps: [('in' | 'out' | 'actual')[], number, number][] = [
      [['out', 'out'], 0.8, 11],
      [['out', 'out', 'out'], 0.5, 4],
      [['actual', 'in', 'in'], 1.25, 21],
      [['in', 'in', 'in'], 2, 37],
    ];
    for (const [presses, factor, y] of steps) {
      for (const to of presses) h.zoom(to);
      expect(h.zoom('current')).toEqual({ factor });
      expect(lights()).toEqual([{ x: 16, y }, { x: 16, y }]);
    }
  });

  it('takes two presses in order, and holds the factor to its bounds', () => {
    const h = harness();
    for (let i = 0; i < 12; i++) h.zoom('in');
    expect(h.zoom('in')).toEqual({ factor: 2 });
    expect(h.calls.filter((call) => call.startsWith('emit')).map((call) => Number(call.split(' ')[2]))).toEqual([1.1, 1.25, 1.5, 1.75, 2]);
  });

  it('skips a window that has closed', () => {
    const h = harness();
    h.windows[1]!.destroyed = true;
    h.zoom('in');
    expect(h.calls.some((call) => call.startsWith('w2'))).toBe(false);
    expect(h.calls).toContain('w1 placed');
  });

  it('reads an invalid stored value as 100 %, and leaves it as found until a change', () => {
    writeFileSync(file, JSON.stringify({ 'window.zoom': { version: 1, factor: 9 }, regions: { width: 240 } }));
    const h = harness();
    expect(h.zoom('current')).toEqual({ factor: 1 });
    expect(h.zoom('actual')).toEqual({ factor: 1 });
    expect(onDisk()['window.zoom']).toEqual({ version: 1, factor: 9 });
    expect(h.calls).toEqual([]);
    expect(h.zoom('in')).toEqual({ factor: 1.1 });
    expect(onDisk()).toEqual({ 'window.zoom': { version: 1, factor: 1.1 }, regions: { width: 240 } });
  });
});

// Finding 7: after a failed write the store, the file, the next window and the next press all have the factor from before
describe('layout.zoom when the key cannot be written', () => {
  it.each([
    ['Zoom In from 100 %', null, 'in', 1.1],
    ['Zoom In from 125 %', { version: 1, factor: 1.25 }, 'in', 1.5],
    ['Actual Size from 125 %, a removal', { version: 1, factor: 1.25 }, 'actual', 1.5],
  ] as const)('%s: answers the error, and changes nothing anywhere', (_name, stored, to, next) => {
    if (stored) writeFileSync(file, JSON.stringify({ 'window.zoom': stored }));
    const before = stored?.factor ?? 1;
    const { writer, layout } = failingStore();
    const h = harness({ layout });
    writer.fails = 1;
    expect(() => h.zoom(to)).toThrow(/EIO/);
    expect(h.calls).toEqual([]); // steps 3 to 5: no window zoomed, nothing placed, no event
    expect(readFactor(layout.get('window.zoom'))).toBe(before);
    layout.set('regions', { width: 260 }); // an unrelated write afterwards
    expect(readFactor(onDisk()['window.zoom'])).toBe(before);
    expect(openAt()).toEqual({ zoomMode: 'isolated', zoomFactor: before }); // a window made afterwards
    expect(h.zoom('in')).toEqual({ factor: next }); // the next press steps from the old factor, and not past it
    expect(readFactor(onDisk()['window.zoom'])).toBe(next); // the control: a write that succeeds is read back
  });
});

describe('the factor a window opens at, and zoomOf', () => {
  it('opens a window isolated at the stored factor: 1.25 while the factor is 1.25', () => {
    const h = harness();
    expect(openAt()).toEqual({ zoomMode: 'isolated', zoomFactor: 1 });
    h.zoom('in');
    h.zoom('in');
    expect(openAt()).toEqual({ zoomMode: 'isolated', zoomFactor: 1.25 });
  });

  it('is the app window’s factor for its own page and for a view attached to it, and 1 for any other contents', () => {
    const h = harness();
    const view = { webContents: { id: 'a tab' } };
    h.windows[0]!.contentView.children.push(view);
    h.zoom('in');
    h.zoom('in');
    expect(zoomOf(h.windows[0]!.webContents as unknown as WebContents)).toBe(1.25);
    expect(zoomOf(view.webContents as unknown as WebContents)).toBe(1.25);
    expect(zoomOf({ id: 'a capture window' } as unknown as WebContents)).toBe(1);
  });
});

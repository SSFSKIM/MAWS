// UX wave U6b-5b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, placement 5; M1's row f): a window made while
// the factor is stored opens at it, its traffic lights centred in the toolbar at that factor, at Electron's own call (the
// window's options). Electron and the frame policies are stood in for; the zoom module is the real one, bound to a layout
// that holds the factor.
import { EventEmitter } from 'node:events';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';

const made: { options: { trafficLightPosition?: unknown; webPreferences?: Record<string, unknown> } }[] = [];
vi.mock('electron', () => ({
  app: { getPath: () => '' },
  session: {},
  BrowserWindow: class extends EventEmitter {
    readonly webContents = { setWindowOpenHandler: () => {} };
    constructor(readonly options: { trafficLightPosition?: unknown }) {
      super();
      made.push(this);
    }
    loadFile = () => Promise.resolve();
    loadURL = () => Promise.resolve();
  },
}));
vi.mock('../render/policies', () => ({ attributeConsole: () => {}, guardFrames: () => {}, guardWindowNavigation: () => {}, isCspExempt: () => false }));

const { createWindow } = await import('./window');
const { startZoom } = await import('./zoom');
const { bindLocalMachine } = await import('./machine/local');

let stored: unknown = null;
beforeAll(() => {
  bindLocalMachine('TestMachineRef00000000' as MachineRef);
  startZoom({ layout: { get: () => stored, publish: () => {} } as never, windows: () => [], placeAgain: () => {}, emit: () => {}, register: (() => {}) as never });
});

describe('createWindow at the stored factor (U6b-5b, placement 5)', () => {
  it.each([
    [null, 1, { x: 16, y: 15 }], // the control: nothing stored is 100 %, where C5 put the lights
    [{ version: 1, factor: 0.5 }, 0.5, { x: 16, y: 4 }],
    [{ version: 1, factor: 0.8 }, 0.8, { x: 16, y: 11 }],
    [{ version: 1, factor: 1.25 }, 1.25, { x: 16, y: 21 }],
    [{ version: 1, factor: 2 }, 2, { x: 16, y: 37 }],
  ])('with %j stored opens isolated at %s, its lights at %j', (value, factor, lights) => {
    stored = value;
    createWindow('light');
    const { options } = made.at(-1)!;
    expect(options.trafficLightPosition).toEqual(lights);
    expect(options.webPreferences).toMatchObject({ zoomMode: 'isolated', zoomFactor: factor });
  });
});

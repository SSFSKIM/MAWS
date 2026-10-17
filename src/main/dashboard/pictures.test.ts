// Word's fallback pictures through one reused capture window (P3-E2 M5 correction; P3-E Decision Log 33): a dashboard
// with many charts navigates the one window once per chart, so the window's listeners must not grow with the charts.
// The window is A's capture window with the real load helpers; only the window itself is a stand-in.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const contents = new EventEmitter() as EventEmitter & { id: number; loadURL(url: string): Promise<void>; capturePage(rect: unknown): Promise<{ toPNG(): Buffer }> };
contents.id = 7;
contents.loadURL = async () => {
  setImmediate(() => {
    contents.emit('did-finish-load');
    setImmediate(() => contents.emit('paint'));
  });
};
contents.capturePage = async () => ({ toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
const sizes: [number, number][] = [];
let destroyed = false;
const win = { webContents: contents, setBackgroundColor() {}, setContentSize: (w: number, h: number) => void sizes.push([w, h]), isDestroyed: () => destroyed, destroy: () => void (destroyed = true) };

vi.mock('electron', () => ({ BrowserWindow: class {} }));
vi.mock('../artifacts/capture', async (actual) => ({ ...(await actual<typeof import('../artifacts/capture')>()), openCaptureWindow: vi.fn(() => win) }));
vi.mock('../artifacts/policies', async (actual) => ({ ...(await actual<typeof import('../artifacts/policies')>()), restrictRequests: vi.fn(() => () => {}) }));
import { openCaptureWindow } from '../artifacts/capture';
import { openFigurePictures } from './pictures';

const SVG = (i: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 672 ${200 + i}" width="672" height="${200 + i}"></svg>`;

describe('openFigurePictures', () => {
  it('takes 30 pictures in one window, twice each figure’s size, its listeners not growing, the window gone at close', async () => {
    const pictures = openFigurePictures({})({ signal: new AbortController().signal, facesCss: async () => '' });
    const baseline = { finish: contents.listenerCount('did-finish-load'), fail: contents.listenerCount('did-fail-load'), paint: contents.listenerCount('paint') };
    for (let i = 0; i < 30; i++) expect([...(await pictures.take(SVG(i), { width: 672, height: 200 + i }))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(openCaptureWindow).toHaveBeenCalledTimes(1);
    expect(sizes.at(-1)).toEqual([1344, 2 * 229]);
    expect({ finish: contents.listenerCount('did-finish-load'), fail: contents.listenerCount('did-fail-load'), paint: contents.listenerCount('paint') }).toEqual(baseline);
    pictures.close();
    await vi.waitFor(() => expect(destroyed).toBe(true));
  });
});

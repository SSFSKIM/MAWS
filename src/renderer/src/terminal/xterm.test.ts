import { FitAddon } from '@xterm/addon-fit';
import type { ITerminalOptions } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RendererOptions } from './renderer';
import { installScrollUpIntoScrollback } from './scroll-up';
import { createXtermRenderer } from './xterm';

const recorded = vi.hoisted(() => [] as ITerminalOptions[]);
vi.mock('@xterm/xterm', async (importOriginal) => {
  const xterm = await importOriginal<typeof import('@xterm/xterm')>();
  class RecordingTerminal extends xterm.Terminal {
    constructor(options?: ITerminalOptions) {
      super(options);
      recorded.push(options ?? {});
    }
  }
  return { ...xterm, Terminal: RecordingTerminal };
});

const options: RendererOptions = {
  scrollback: 100,
  webgl: false,
  font: { family: 'monospace', size: 13, lineHeight: 1.2 },
  theme: { background: 'white', foreground: 'black', cursor: 'black', cursorAccent: 'white', selectionBackground: 'grey', ansi: Array(16).fill('black') },
};

const sized = (el: HTMLElement, width: number, height: number) => {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('xterm adapter', () => {
  it('measures nothing for a detached or zero-sized container, where the fit addon would propose 2×1', () => {
    vi.spyOn(FitAddon.prototype, 'proposeDimensions').mockReturnValue({ cols: 2, rows: 1 });
    const renderer = createXtermRenderer(options);
    sized(renderer.element, 800, 400);
    expect(renderer.fit()).toBeNull(); // detached
    document.body.append(renderer.element);
    sized(renderer.element, 0, 400);
    expect(renderer.fit()).toBeNull(); // connected, no width (a hidden panel)
    sized(renderer.element, 800, 0);
    expect(renderer.fit()).toBeNull();
    sized(renderer.element, 800, 400);
    expect(renderer.fit()).toEqual({ cols: 2, rows: 1 });
    renderer.dispose();
  });

  it('lets OSC 8 links of any scheme reach the link handler, main being the one scheme check', () => {
    const renderer = createXtermRenderer(options);
    const opened: string[] = [];
    renderer.setLinkHandler((url) => opened.push(url));
    const linkHandler = recorded.at(-1)!.linkHandler!;
    expect(linkHandler.allowNonHttpProtocols).toBe(true);
    linkHandler.activate(new MouseEvent('mouseup'), 'mailto:owner@example.com', { start: { x: 1, y: 1 }, end: { x: 1, y: 1 } });
    expect(opened).toEqual(['mailto:owner@example.com']);
    renderer.dispose();
  });

  // The M5 ruling's guard, against the shipped build: an xterm bump that moves the internals fails here instead of
  // silently falling back to discarding the rows (the headless pins cover the behaviour on @xterm/headless).
  it('finds the internals its CSI S handler needs on the shipped xterm, and keeps scrolled-out rows', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { Terminal } = await vi.importActual<typeof import('@xterm/xterm')>('@xterm/xterm');
    const { version } = await import('@xterm/xterm/package.json');
    expect(version).toBe('6.0.0');
    const bare = new Terminal();
    expect(installScrollUpIntoScrollback(bare, { version })).toBe(true);
    bare.dispose();

    const renderer = createXtermRenderer(options);
    expect(warn.mock.calls.filter(([message]) => String(message).includes('CSI S'))).toEqual([]);
    const lines = Array.from({ length: 30 }, (_, i) => `${i + 1}`);
    await new Promise<void>((resolve) => renderer.write(`${lines.join('\r\n')}\r\n\x1b[1;23r\x1b[5S\x1b[r`, resolve));
    const probe = renderer.probe();
    const buffer = Array.from({ length: probe.lineCount() }, (_, i) => probe.line(i).trim());
    expect(lines.filter((line) => !buffer.includes(line))).toEqual([]);
    renderer.dispose();
  });
});

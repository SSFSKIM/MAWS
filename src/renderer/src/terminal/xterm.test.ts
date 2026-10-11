import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  // C1 (P2-F wave S): the IME's composing text is drawn in the terminal's tokens, never xterm's stock white text on black.
  // The sheets are the ones xterm.ts imports (happy-dom applies no imported CSS), in the bundle's order.
  it.each(['light', 'dark'])('draws the composition view in the terminal tokens in %s', (theme) => {
    const sheets = ['../../../../node_modules/@xterm/xterm/css/xterm.css', '../styles/tokens.css', ...imported(/^\.\/.+\.css$/)];
    const style = document.createElement('style');
    style.textContent = sheets.map((sheet) => readFileSync(resolve(__dirname, sheet), 'utf8')).join('\n');
    document.head.append(style);
    document.documentElement.dataset.theme = theme;
    try {
      const renderer = createXtermRenderer(options);
      document.body.append(renderer.element);
      const view = renderer.element.querySelector<HTMLElement>('.composition-view')!;
      const swatch = document.createElement('div');
      swatch.style.background = 'var(--term-bg)';
      swatch.style.color = 'var(--term-fg)';
      document.body.append(swatch);
      const drawn = getComputedStyle(view);
      expect(drawn.backgroundColor).toBe(getComputedStyle(swatch).backgroundColor);
      expect(drawn.color).toBe(getComputedStyle(swatch).color);
      expect(drawn.backgroundColor).not.toBe(getComputedStyle(swatch).color); // the tokens resolved: background and text differ
      renderer.dispose();
    } finally {
      style.remove();
      delete document.documentElement.dataset.theme;
    }
  });
});

// The stylesheets of this directory xterm.ts imports, as paths relative to this file.
function imported(pattern: RegExp): string[] {
  const source = readFileSync(resolve(__dirname, 'xterm.ts'), 'utf8');
  return [...source.matchAll(/^import '([^']+)';/gm)].map((match) => match[1]!).filter((path) => pattern.test(path));
}

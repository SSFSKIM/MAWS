// The xterm.js adapter (C9 Interfaces *Terminal renderer adapter*, Residue *Renderer*, *WebGL policy*): xterm 6.0.0
// with the fit, web-links, unicode-graphemes and serialize addons, and the WebGL addon held only while visible.
// Nothing from xterm's proposed API beyond what the graphemes addon needs; one guarded internal call, the dated
// exception of the M5 ruling (`scroll-up.ts`: `CSI S` rows into scrollback).
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './xterm-overrides.css'; // the composition view in the terminal tokens (C1, P2-F wave S)
import { version as xtermVersion } from '@xterm/xterm/package.json';
import {
  ansiNamed,
  type Acceleration,
  type RendererOptions,
  type TerminalFont,
  type TerminalProbe,
  type TerminalRenderer,
  type TerminalTheme,
} from './renderer';
import { installScrollUpIntoScrollback } from './scroll-up';

const toXtermTheme = (theme: TerminalTheme): ITheme => ({
  background: theme.background,
  foreground: theme.foreground,
  cursor: theme.cursor,
  cursorAccent: theme.cursorAccent,
  selectionBackground: theme.selectionBackground,
  ...ansiNamed(theme),
});

export function createXtermRenderer(opts: RendererOptions): TerminalRenderer {
  const element = document.createElement('div');
  element.dataset.renderer = 'xterm';
  element.style.width = '100%';
  element.style.height = '100%';

  let linkHandler: (url: string, ev: MouseEvent) => void = () => {};
  let keyFilter: (ev: KeyboardEvent) => boolean = () => true;
  const terminal = new Terminal({
    scrollback: opts.scrollback,
    allowProposedApi: true,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    cursorBlink: false,
    fontFamily: opts.font.family,
    fontSize: opts.font.size,
    lineHeight: opts.font.lineHeight,
    theme: toXtermTheme(opts.theme),
    // xterm drops OSC 8 links whose scheme is not http(s) before any handler runs unless this is set; main's
    // `openExternalUrl` is the one scheme check (Residue *Copy, paste and links*).
    linkHandler: { activate: (ev, text) => linkHandler(text, ev), allowNonHttpProtocols: true },
  });
  const fit = new FitAddon();
  const serializer = new SerializeAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(new UnicodeGraphemesAddon()); // sets unicode.activeVersion = '15-graphemes' on activate
  terminal.loadAddon(new WebLinksAddon((ev, uri) => linkHandler(uri, ev)));
  terminal.loadAddon(serializer);
  terminal.attachCustomKeyEventHandler((ev) => keyFilter(ev));
  installScrollUpIntoScrollback(terminal, { version: xtermVersion, refresh: () => terminal.refresh(0, terminal.rows - 1) });
  terminal.open(element);

  let acceleration: Acceleration = 'dom';
  const accelerationListeners = new Set<(a: Acceleration) => void>();
  const setAcceleration = (a: Acceleration) => {
    if (acceleration === a) return;
    acceleration = a;
    accelerationListeners.forEach((cb) => cb(a));
  };

  // The WebGL addon is loaded after open() and only while the terminal is visible. The addon itself waits three
  // seconds for the browser to restore a lost context before it fires onContextLoss (Residue *WebGL policy*); then
  // it is dropped at once and the DOM renderer continues (the next show retries).
  let webgl: WebglAddon | null = null;
  let visible = false;
  const releaseWebgl = () => {
    webgl?.dispose();
    webgl = null;
    setAcceleration('dom');
  };
  const acquireWebgl = () => {
    if (webgl || !opts.webgl) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        if (webgl === addon) releaseWebgl();
      });
      terminal.loadAddon(addon);
      webgl = addon;
      setAcceleration('webgl');
    } catch (error) {
      console.warn('[terminal] WebGL addon failed to load; staying on the DOM renderer', error);
      releaseWebgl();
    }
  };

  const probe: TerminalProbe = {
    get cols() {
      return terminal.cols;
    },
    get rows() {
      return terminal.rows;
    },
    get cursorX() {
      return terminal.buffer.active.cursorX;
    },
    get cursorY() {
      return terminal.buffer.active.cursorY;
    },
    line: (row) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? '',
    lineCount: () => terminal.buffer.active.length,
    modes: () => ({
      alternateScreen: terminal.buffer.active.type === 'alternate',
      bracketedPaste: terminal.modes.bracketedPasteMode,
      applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
      mouseTracking: terminal.modes.mouseTrackingMode,
    }),
  };

  return {
    kind: 'xterm',
    element,
    get acceleration() {
      return acceleration;
    },
    write: (data, onParsed) => terminal.write(data, onParsed),
    onData: (cb) => terminal.onData(cb).dispose,
    onTitle: (cb) => terminal.onTitleChange(cb).dispose,
    onBell: (cb) => terminal.onBell(cb).dispose,
    onAccelerationChange(cb) {
      accelerationListeners.add(cb);
      return () => accelerationListeners.delete(cb);
    },
    fit() {
      // The fit addon clamps a hidden or detached container to 2×1 instead of refusing it, so the layout is checked
      // first: a size is only measured for a connected element with a non-zero client box.
      if (!element.isConnected || element.clientWidth === 0 || element.clientHeight === 0) return null;
      const dims = fit.proposeDimensions();
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < 1 || dims.rows < 1) return null;
      return { cols: dims.cols, rows: dims.rows };
    },
    resize: (cols, rows) => terminal.resize(cols, rows),
    focus: () => terminal.focus(),
    blur: () => terminal.blur(),
    clear: () => terminal.clear(),
    reset: () => terminal.reset(),
    serialize: () => serializer.serialize(),
    setTheme(theme) {
      terminal.options.theme = toXtermTheme(theme);
    },
    setFont(font: TerminalFont) {
      terminal.options.fontFamily = font.family;
      terminal.options.fontSize = font.size;
      terminal.options.lineHeight = font.lineHeight;
    },
    setKeyFilter(filter) {
      keyFilter = filter;
    },
    setLinkHandler(handler) {
      linkHandler = handler;
    },
    hasSelection: () => terminal.hasSelection(),
    getSelection: () => terminal.getSelection(),
    selectAll: () => terminal.selectAll(),
    paste: (text) => terminal.paste(text),
    setVisible(next) {
      visible = next;
      if (visible) acquireWebgl();
      else releaseWebgl();
    },
    simulateContextLoss() {
      // The addon's canvas is the one WebGL canvas under the container; asking it for the context it already holds
      // returns that context, whose lose_context extension fires `webglcontextlost` like a real eviction.
      for (const canvas of element.querySelectorAll('canvas')) {
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        const ext = gl?.getExtension('WEBGL_lose_context');
        if (ext) {
          ext.loseContext();
          return;
        }
      }
    },
    probe: () => probe,
    dispose() {
      releaseWebgl();
      terminal.dispose();
      element.remove();
    },
  };
}

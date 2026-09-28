// The ghostty-web adapter (C9 M1, the spike's second candidate; deleted on discard): Ghostty's VT core in WASM with
// the package's Canvas 2D renderer. Its `write` parses synchronously and only draws on the next frame, so `onParsed`
// fires right after the parse. Its built-in link providers open URLs themselves, so they are wrapped to route
// activation through the adapter's handler; its custom key handler's return value is inverted relative to xterm's
// (coder/ghostty-web issue 192: true means "handled, skip the terminal"), so the filter is negated here.
import { FitAddon, init, OSC8LinkProvider, Terminal, UrlRegexProvider, type ILinkProvider, type ITheme } from 'ghostty-web';
import { ansiNamed, type RendererOptions, type TerminalModes, type TerminalProbe, type TerminalRenderer, type TerminalTheme } from './renderer';

let wasmReady: Promise<void> | null = null;
const ensureWasm = () => (wasmReady ??= init());

const toGhosttyTheme = (theme: TerminalTheme): ITheme => ({
  background: theme.background,
  foreground: theme.foreground,
  cursor: theme.cursor,
  cursorAccent: theme.cursorAccent,
  selectionBackground: theme.selectionBackground,
  ...ansiNamed(theme),
});

export async function createGhosttyRenderer(opts: RendererOptions): Promise<TerminalRenderer> {
  await ensureWasm();

  const element = document.createElement('div');
  element.dataset.renderer = 'ghostty';
  element.style.width = '100%';
  element.style.height = '100%';

  let linkHandler: (url: string, ev: MouseEvent) => void = () => {};
  let keyFilter: (ev: KeyboardEvent) => boolean = () => true;

  const terminal = new Terminal({
    scrollback: opts.scrollback, // a byte budget in Ghostty core, not a line count (M1 finding, item 7)
    cursorBlink: false,
    fontFamily: opts.font.family,
    fontSize: opts.font.size,
    theme: toGhosttyTheme(opts.theme),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.attachCustomKeyEventHandler((ev) => !keyFilter(ev));
  terminal.open(element);

  const routed = (inner: ILinkProvider): ILinkProvider => ({
    provideLinks(y, callback) {
      inner.provideLinks(y, (links) => callback(links?.map((link) => ({ ...link, activate: (ev) => linkHandler(link.text, ev) }))));
    },
    dispose: () => inner.dispose?.(),
  });
  terminal.registerLinkProvider(routed(new OSC8LinkProvider(terminal)));
  terminal.registerLinkProvider(routed(new UrlRegexProvider(terminal)));

  const mouseTracking = (): TerminalModes['mouseTracking'] => {
    if (terminal.getMode(1003)) return 'any';
    if (terminal.getMode(1002)) return 'drag';
    if (terminal.getMode(1000)) return 'vt200';
    if (terminal.getMode(9)) return 'x10';
    return 'none';
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
      bracketedPaste: terminal.hasBracketedPaste(),
      applicationCursorKeys: terminal.getMode(1),
      mouseTracking: mouseTracking(),
    }),
  };

  return {
    kind: 'ghostty',
    element,
    acceleration: 'canvas2d',
    write(data, onParsed) {
      terminal.write(data);
      onParsed();
    },
    onData: (cb) => terminal.onData(cb).dispose,
    onTitle: (cb) => terminal.onTitleChange(cb).dispose,
    onBell: (cb) => terminal.onBell(cb).dispose,
    onAccelerationChange: () => () => {},
    fit() {
      const dims = fit.proposeDimensions();
      if (!dims || dims.cols < 1 || dims.rows < 1) return null;
      return { cols: dims.cols, rows: dims.rows };
    },
    resize: (cols, rows) => terminal.resize(cols, rows),
    focus: () => terminal.focus(),
    blur: () => terminal.blur(),
    clear: () => terminal.clear(),
    reset: () => terminal.reset(),
    serialize: () => null,
    setTheme(theme) {
      terminal.options.theme = toGhosttyTheme(theme);
    },
    setFont(font) {
      terminal.options.fontFamily = font.family;
      terminal.options.fontSize = font.size;
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
    setVisible() {},
    probe: () => probe,
    dispose() {
      terminal.dispose();
      element.remove();
    },
  };
}

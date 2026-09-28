// The renderer adapter (C9 Interfaces *Terminal renderer adapter*): the one interface behind which the terminal
// emulator library sits. Two implementations exist during the spike (`xterm.ts`, `ghostty.ts`); the product ships
// one and keeps the seam so a future libghostty package re-runs the same spike without touching the tool.

export type RendererKind = 'xterm' | 'ghostty';
export type Acceleration = 'webgl' | 'dom' | 'canvas2d';

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  ansi: readonly string[]; // exactly 16, ANSI order: black red green yellow blue magenta cyan white, then their bright variants
}

export interface TerminalFont {
  family: string;
  size: number;
  lineHeight: number;
}

export interface TerminalModes {
  alternateScreen: boolean;
  bracketedPaste: boolean;
  applicationCursorKeys: boolean;
  mouseTracking: 'none' | 'x10' | 'vt200' | 'drag' | 'any';
}

// Tests and the spike read the buffer through this, never through library internals.
export interface TerminalProbe {
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number; // relative to the viewport's base (the screen's top row is 0)
  line(row: number): string; // row counted from the top of the whole buffer (scrollback first)
  lineCount(): number;
  modes(): TerminalModes;
}

export interface TerminalRenderer {
  readonly kind: RendererKind;
  readonly element: HTMLElement; // the container it draws into; the owner mounts it
  readonly acceleration: Acceleration;
  write(data: Uint8Array | string, onParsed: () => void): void; // onParsed fires when the bytes are in the buffer
  onData(cb: (input: string) => void): () => void; // keystrokes, paste, mouse reports and terminal replies bound for the pty
  onTitle(cb: (title: string) => void): () => void;
  onBell(cb: () => void): () => void;
  onAccelerationChange(cb: (a: Acceleration) => void): () => void;
  fit(): { cols: number; rows: number } | null; // measures the container; null when it has no size
  resize(cols: number, rows: number): void;
  focus(): void;
  blur(): void;
  clear(): void;
  reset(): void; // full emulator reset (buffers, modes, attributes)
  serialize(): string | null; // the emulator's state as a byte string that rebuilds it; null when the renderer cannot
  setTheme(theme: TerminalTheme): void;
  setFont(font: TerminalFont): void;
  setKeyFilter(filter: (ev: KeyboardEvent) => boolean): void; // true: the terminal consumes the key; false: the app gets it
  setLinkHandler(handler: (url: string, ev: MouseEvent) => void): void;
  hasSelection(): boolean;
  getSelection(): string;
  selectAll(): void;
  paste(text: string): void;
  setVisible(visible: boolean): void; // acquire or release acceleration (Residue *WebGL policy*)
  simulateContextLoss?(): void; // test hook, xterm only: WEBGL_lose_context.loseContext()
  probe(): TerminalProbe;
  dispose(): void;
}

export interface RendererOptions {
  scrollback: number;
  theme: TerminalTheme;
  font: TerminalFont;
  webgl: boolean;
}

// Async because ghostty-web needs its WASM initialised; the adapters are loaded lazily so a page that never asks for
// one never pays for its bundle.
export async function createRenderer(kind: RendererKind, opts: RendererOptions): Promise<TerminalRenderer> {
  switch (kind) {
    case 'xterm':
      return (await import('./xterm')).createXtermRenderer(opts);
    case 'ghostty':
      return (await import('./ghostty')).createGhosttyRenderer(opts);
  }
}

// A theme in the sixteen-colour form both libraries take.
export function ansiNamed(theme: TerminalTheme): Record<string, string> {
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  const out: Record<string, string> = {};
  names.forEach((name, i) => {
    out[name] = theme.ansi[i]!;
    out[`bright${name[0]!.toUpperCase()}${name.slice(1)}`] = theme.ansi[i + 8]!;
  });
  return out;
}

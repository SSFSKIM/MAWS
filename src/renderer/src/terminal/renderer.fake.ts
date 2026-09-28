// A `TerminalRenderer` for tests (C9 Interfaces *Testing and harness*): no emulator, just a record of what the owner
// asked of it and handles to drive it the way a user or a program would. Exported for tests only; production code
// never imports it.
import type { Acceleration, RendererOptions, TerminalFont, TerminalModes, TerminalProbe, TerminalRenderer, TerminalTheme } from './renderer';

const decoder = new TextDecoder();

export class FakeRenderer implements TerminalRenderer {
  readonly kind = 'xterm' as const;
  readonly element = document.createElement('div');
  acceleration: Acceleration = 'dom';
  /** Everything written, in order, as text. */
  readonly writes: string[] = [];
  /** Parse callbacks not yet run when `autoParse` is off. */
  readonly unparsed: (() => void)[] = [];
  autoParse = true;
  /** What `fit()` measures; `null` is a container with no size. */
  fitSize: { cols: number; rows: number } | null = { cols: 80, rows: 24 };
  /** What `serialize()` returns; `null` is a renderer that cannot. */
  serialized: string | null = 'SERIALIZED';
  readonly resizes: [number, number][] = [];
  resets = 0;
  clears = 0;
  disposed = false;
  focused = false;
  visible = false;
  theme: TerminalTheme;
  font: TerminalFont;
  keyFilter: ((ev: KeyboardEvent) => boolean) | null = null;
  linkHandler: ((url: string, ev: MouseEvent) => void) | null = null;
  private readonly dataListeners = new Set<(input: string) => void>();
  private readonly titleListeners = new Set<(title: string) => void>();
  private readonly accelerationListeners = new Set<(a: Acceleration) => void>();

  constructor(readonly options: RendererOptions) {
    this.theme = options.theme;
    this.font = options.font;
  }

  write(data: Uint8Array | string, onParsed: () => void): void {
    this.writes.push(typeof data === 'string' ? data : decoder.decode(data));
    if (this.autoParse) onParsed();
    else this.unparsed.push(onParsed);
  }

  parseAll(): void {
    this.unparsed.splice(0).forEach((cb) => cb());
  }

  onData(cb: (input: string) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onTitle(cb: (title: string) => void): () => void {
    this.titleListeners.add(cb);
    return () => this.titleListeners.delete(cb);
  }

  onBell(): () => void {
    return () => {};
  }

  onAccelerationChange(cb: (a: Acceleration) => void): () => void {
    this.accelerationListeners.add(cb);
    return () => this.accelerationListeners.delete(cb);
  }

  fit(): { cols: number; rows: number } | null {
    return this.fitSize;
  }

  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }

  focus(): void {
    this.focused = true;
  }

  blur(): void {
    this.focused = false;
  }

  clear(): void {
    this.clears++;
  }

  reset(): void {
    this.resets++;
  }

  serialize(): string | null {
    return this.serialized;
  }

  setTheme(theme: TerminalTheme): void {
    this.theme = theme;
  }

  setFont(font: TerminalFont): void {
    this.font = font;
  }

  setKeyFilter(filter: (ev: KeyboardEvent) => boolean): void {
    this.keyFilter = filter;
  }

  setLinkHandler(handler: (url: string, ev: MouseEvent) => void): void {
    this.linkHandler = handler;
  }

  hasSelection(): boolean {
    return false;
  }

  getSelection(): string {
    return '';
  }

  selectAll(): void {}

  paste(text: string): void {
    this.type(text);
  }

  // Acceleration follows the adapter's policy: WebGL while visible, when the options allow it.
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.setAcceleration(visible && this.options.webgl ? 'webgl' : 'dom');
  }

  simulateContextLoss(): void {
    this.setAcceleration('dom');
  }

  probe(): TerminalProbe {
    const modes: TerminalModes = { alternateScreen: false, bracketedPaste: false, applicationCursorKeys: false, mouseTracking: 'none' };
    return { cols: 80, rows: 24, cursorX: 0, cursorY: 0, line: () => '', lineCount: () => 0, modes: () => modes };
  }

  dispose(): void {
    this.disposed = true;
    this.element.remove();
  }

  // Drivers: what a user or a program does to a real renderer.
  type(input: string): void {
    this.dataListeners.forEach((cb) => cb(input));
  }

  setTitle(title: string): void {
    this.titleListeners.forEach((cb) => cb(title));
  }

  /** Runs the installed key filter as the emulator would for a key event; true means the terminal consumed it. */
  key(type: 'keydown' | 'keyup', init: KeyboardEventInit): boolean {
    return this.keyFilter ? this.keyFilter(new KeyboardEvent(type, init)) : true;
  }

  /** Activates a link as the emulator does, on the `mouseup` that ends a click on it. */
  clickLink(url: string, init: MouseEventInit = {}): void {
    this.linkHandler?.(url, new MouseEvent('mouseup', init));
  }

  private setAcceleration(a: Acceleration): void {
    if (this.acceleration === a) return;
    this.acceleration = a;
    this.accelerationListeners.forEach((cb) => cb(a));
  }
}

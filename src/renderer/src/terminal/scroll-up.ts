// `CSI Ps S` (scroll up) into scrollback: the dated exception to the adapter's "public API only" rule (C9 Interfaces,
// M5 ruling, 2026-09-29). xterm.js 6.0.0's own scroll-up (`InputHandler.scrollUp`) deletes the rows it moves out of
// the scroll region; tmux, iTerm2 and kitty put them in scrollback when the region starts at the top row, and codex's
// inline viewport pushes its history (and the shell rows above it) out with exactly that sequence. On the normal
// buffer with the region's top at row 1, this handler scrolls `Ps` times through xterm's own line-feed scroll
// (`BufferService.scroll`, the one internal call, against the exact pin 6.0.0) with SU's erase attributes; everywhere
// else it returns `false` and xterm's handler runs. Shared by the browser adapter and the headless pins.

interface AttributeData {
  bg: number;
}
interface InternalBuffer {
  scrollTop: number;
  scrollBottom: number;
}
interface Internals {
  bufferService: { readonly buffer: InternalBuffer; readonly buffers: { readonly normal: InternalBuffer }; scroll(eraseAttr: AttributeData, isWrapped?: boolean): void };
  eraseAttrData(): AttributeData;
}
interface Disposable {
  dispose(): void;
}
// What both `@xterm/xterm` and `@xterm/headless` terminals offer: the public parser hook, plus the private `_core`.
export interface ScrollUpTarget {
  readonly parser: { registerCsiHandler(id: { final: string }, callback: (params: (number | number[])[]) => boolean): Disposable };
}

// The members the handler needs, checked for shape; null when this xterm is not laid out as 6.0.0 is.
function internalsOf(terminal: ScrollUpTarget): Internals | null {
  const core = (terminal as { _core?: Record<string, unknown> })._core;
  const bufferService = core?._bufferService as Record<string, unknown> | undefined;
  const inputHandler = core?._inputHandler as Record<string, unknown> | undefined;
  if (!bufferService || !inputHandler) return null;
  if (typeof bufferService.scroll !== 'function' || typeof inputHandler._eraseAttrData !== 'function') return null;
  const buffers = bufferService.buffers as { normal?: Partial<InternalBuffer> } | undefined;
  const buffer = bufferService.buffer as Partial<InternalBuffer> | undefined;
  if (!buffers?.normal || !buffer || typeof buffer.scrollTop !== 'number' || typeof buffer.scrollBottom !== 'number') return null;
  return { bufferService: bufferService as unknown as Internals['bufferService'], eraseAttrData: () => (inputHandler._eraseAttrData as () => AttributeData).call(inputHandler) };
}

// Installs the handler; returns false (and warns once, naming `version`) when the internals are missing, in which case
// xterm's own scroll-up stands. `refresh` repaints the viewport after a handled scroll (the browser terminal's
// `refresh` over every row: the rows moved and the viewport may be scrolled; a headless terminal has nothing to paint).
export function installScrollUpIntoScrollback(
  terminal: ScrollUpTarget,
  opts: { version: string; refresh?: () => void },
): boolean {
  const internals = internalsOf(terminal);
  if (!internals) {
    console.warn(`[terminal] xterm ${opts.version}: the internals behind CSI S into scrollback are not where 6.0.0 has them; scroll-up keeps xterm's own behaviour (rows scrolled out of the region are discarded)`);
    return false;
  }
  const { bufferService } = internals;
  terminal.parser.registerCsiHandler({ final: 'S' }, (params) => {
    const buffer = bufferService.buffer;
    if (buffer !== bufferService.buffers.normal || buffer.scrollTop !== 0) return false;
    // `toArray()` places a parameter's sub-parameters after it, so the first entry is always a number; like xterm's own
    // SU, sub-parameters are ignored.
    const first = (params[0] as number | undefined) ?? 0;
    // Beyond the region's height every further step only scrolls blank rows (tmux clamps the same way).
    const count = Math.min(first || 1, buffer.scrollBottom - buffer.scrollTop + 1);
    const erase = internals.eraseAttrData();
    for (let i = 0; i < count; i++) bufferService.scroll(erase);
    opts.refresh?.();
    return true;
  });
  return true;
}

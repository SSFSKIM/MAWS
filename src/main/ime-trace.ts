// P2-F S ime-trace, temporary (removed once tracker L98's fix is pinned by a replay of its trace): under
// MAWS_IME_TRACE=1 the app window's `[ime-trace]` console lines (renderer/src/terminal/ime-trace.ts) are appended to
// <logs>/ime-trace.log (window.ts). Only the window's own page counts: a deliverable's frame in the same window can log
// a line with the same prefix, and that is not terminal evidence.
import type { WebContents, WebContentsConsoleMessageEventParams } from 'electron';

export type TracedContents = Pick<WebContents, 'mainFrame'> & {
  on(event: 'console-message', listener: (details: Pick<WebContentsConsoleMessageEventParams, 'message' | 'frame'>) => void): unknown;
};

export function recordImeTrace(contents: TracedContents, append: (line: string) => Promise<void>): void {
  let writes = Promise.resolve();
  contents.on('console-message', ({ message, frame }) => {
    if (frame !== contents.mainFrame || !message.startsWith('[ime-trace] ')) return; // the page itself, as the IPC router's sender check
    writes = writes.then(() => append(`${message}\n`)).catch((error: unknown) => console.warn('[ime-trace] could not append', error));
  });
}

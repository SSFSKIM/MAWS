// The terminals' e2e seam in the page (P5 O2 M7's review): `window.__maws_terminals`, installed only when the window was
// loaded for the e2e harness (`e2eRequested`, as the documents' seam). The product's terminal draws on a canvas, so the
// e2e reads what a terminal shows from its emulator's buffer: every line, scrollback first, by the `data-terminal-id`
// its element carries; null while that terminal has no renderer.
import type { TerminalHandle, TerminalId } from './registry';

export interface TerminalsSeam {
  lines(id: string): string[] | null;
}

declare global {
  interface Window {
    __maws_terminals?: TerminalsSeam;
  }
}

export function installTerminalsSeam(win: Window, registry: { get(id: TerminalId): TerminalHandle | undefined }): void {
  win.__maws_terminals = {
    lines(id) {
      const probe = registry.get(id as TerminalId)?.renderer?.probe();
      if (!probe) return null;
      return Array.from({ length: probe.lineCount() }, (_, row) => probe.line(row).trimEnd());
    },
  };
}

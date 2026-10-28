import { describe, expect, it } from 'vitest';
import { installTerminalsSeam } from './e2e-seam';
import type { TerminalHandle, TerminalId } from './registry';
import type { TerminalProbe } from './renderer';

const probe = (lines: string[]): TerminalProbe => ({
  cols: 80,
  rows: 24,
  cursorX: 0,
  cursorY: 0,
  line: (row) => lines[row]!,
  lineCount: () => lines.length,
  modes: () => ({ alternateScreen: false, bracketedPaste: false, applicationCursorKeys: false, mouseTracking: 'none' }),
});

describe('the terminals e2e seam', () => {
  it('reads a terminal’s whole buffer by its id, scrollback first and trimmed; null with no such terminal or no renderer yet', () => {
    const handles = new Map<string, Partial<TerminalHandle>>([
      ['t1', { renderer: { probe: () => probe(['$ sleep 6; echo m7-closed-$((40+2))   ', 'm7-closed-42', '$ ']) } as never }],
      ['t2', { renderer: null }],
    ]);
    const win = {} as Window;
    installTerminalsSeam(win, { get: (id: TerminalId) => handles.get(id) as TerminalHandle | undefined });
    expect(win.__maws_terminals!.lines('t1')).toEqual(['$ sleep 6; echo m7-closed-$((40+2))', 'm7-closed-42', '$']);
    expect(win.__maws_terminals!.lines('t2')).toBeNull();
    expect(win.__maws_terminals!.lines('t3')).toBeNull();
  });
});

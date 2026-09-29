// `CSI S` into scrollback (the M5 ruling) through the real emulator: `@xterm/headless` 6.0.0 with the same handler the
// adapter installs. xterm 6.0.0 discards the rows a scroll-up moves out of the region; tmux, iTerm2 and kitty keep them
// in scrollback when the region starts at the top row, and codex's inline viewport relies on that.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Terminal } from '@xterm/headless';
import { describe, expect, it, vi } from 'vitest';
import { installScrollUpIntoScrollback } from './scroll-up';

const COLS = 189;
const ROWS = 40;
// codex 0.155.1 started in a 189x40 MAWS terminal after `seq 1 60`, then `/quit` with no other input: its output as
// `script -r` recorded it (session id zeroed, byte length kept).
const CODEX = readFileSync(join(__dirname, '__fixtures__/codex-0.155.1-start-quit.bin'));
// The screen codex started on: a prompt, `seq 1 60`, the prompt it was typed at, the cursor on the bottom row.
const SHELL = `$ seq 1 60\r\n${Array.from({ length: 60 }, (_, i) => `${i + 1}\r\n`).join('')}$ codex\r\n`;

function emulator(withHandler: boolean) {
  const terminal = new Terminal({ cols: COLS, rows: ROWS, scrollback: 10_000, allowProposedApi: true });
  if (withHandler) expect(installScrollUpIntoScrollback(terminal, { version: '6.0.0' })).toBe(true);
  const write = (data: string | Uint8Array) => new Promise<void>((resolve) => terminal.write(data, resolve));
  const lines = () => Array.from({ length: terminal.buffer.active.length }, (_, i) => terminal.buffer.active.getLine(i)!.translateToString(true));
  const screen = () => lines().slice(terminal.buffer.active.baseY);
  // The background of every cell of the visible screen, so erase attributes are compared too.
  const backgrounds = () =>
    Array.from({ length: ROWS }, (_, row) => {
      const line = terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)!;
      return Array.from({ length: COLS }, (_, col) => line.getCell(col)!.getBgColor()).join(',');
    });
  return { terminal, write, lines, screen, backgrounds };
}
const missingShellRows = (lines: string[]) => {
  const present = new Set(lines.map((line) => line.trim()));
  return Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => !present.has(String(n)));
};

describe('terminal scroll-up keeps rows in scrollback', () => {
  it('keeps all sixty shell rows above codex after it starts and quits (xterm alone loses seventeen)', async () => {
    const plain = emulator(false);
    await plain.write(SHELL);
    await plain.write(CODEX);
    expect(missingShellRows(plain.lines())).toHaveLength(17); // the defect the handler exists for, on this xterm

    const kept = emulator(true);
    await kept.write(SHELL);
    await kept.write(CODEX);
    expect(missingShellRows(kept.lines())).toEqual([]);
    // In order, once each.
    const numbers = kept.lines().filter((line) => /^\d+$/.test(line.trim())).map(Number);
    expect(numbers).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('moves the rows a top-anchored region scrolls out into scrollback and leaves the screen as xterm draws it', async () => {
    const plain = emulator(false);
    const kept = emulator(true);
    for (const t of [plain, kept]) {
      await t.write(SHELL);
      await t.write('\x1b[44m\x1b[1;39r\x1b[10S\x1b[r\x1b[0m'); // a blue pen: SU erases with its background
    }
    expect(missingShellRows(plain.lines())).toHaveLength(10);
    expect(missingShellRows(kept.lines())).toEqual([]);
    expect(kept.screen()).toEqual(plain.screen());
    expect(kept.backgrounds()).toEqual(plain.backgrounds());
    expect(kept.lines()).toEqual([...plain.lines().slice(0, plain.terminal.buffer.active.baseY), ...kept.lines().slice(plain.terminal.buffer.active.baseY, kept.terminal.buffer.active.baseY), ...plain.screen()]);
    expect(kept.terminal.buffer.active.baseY - plain.terminal.buffer.active.baseY).toBe(10);
    expect(kept.terminal.buffer.active.cursorY).toBe(plain.terminal.buffer.active.cursorY);
  });

  it('scrolls a full-screen region into scrollback, one row by default and at most the region per call', async () => {
    const plain = emulator(false);
    const kept = emulator(true);
    for (const t of [plain, kept]) {
      await t.write(SHELL);
      await t.write('\x1b[S\x1b[0S\x1b[500S');
    }
    expect(kept.screen()).toEqual(plain.screen());
    expect(kept.terminal.buffer.active.baseY - plain.terminal.buffer.active.baseY).toBe(1 + 1 + ROWS);
    expect(missingShellRows(kept.lines())).toEqual([]);
  });

  it('leaves a region whose top is below the first row to xterm', async () => {
    const plain = emulator(false);
    const kept = emulator(true);
    for (const t of [plain, kept]) {
      await t.write(SHELL);
      await t.write('\x1b[5;39r\x1b[3S\x1b[r');
    }
    expect(kept.lines()).toEqual(plain.lines());
    expect(missingShellRows(kept.lines())).toHaveLength(3);
  });

  it('leaves the alternate screen to xterm and the normal buffer untouched', async () => {
    const plain = emulator(false);
    const kept = emulator(true);
    for (const t of [plain, kept]) {
      await t.write(SHELL);
      await t.write(`\x1b[?1049h\x1b[H${Array.from({ length: 30 }, (_, i) => `alt ${i}`).join('\r\n')}\x1b[1;39r\x1b[5S\x1b[r`);
    }
    expect(kept.terminal.buffer.active.type).toBe('alternate');
    expect(kept.lines()).toEqual(plain.lines());
    for (const t of [plain, kept]) await t.write('\x1b[?1049l');
    expect(kept.lines()).toEqual(plain.lines());
    expect(missingShellRows(kept.lines())).toEqual([]);
  });

  it('installs nothing and warns once, naming the version, when the internals it needs are not there', () => {
    const registerCsiHandler = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fake = { parser: { registerCsiHandler }, _core: { _bufferService: { buffers: {} } } };
      expect(installScrollUpIntoScrollback(fake as never, { version: '9.9.9' })).toBe(false);
      expect(registerCsiHandler).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('9.9.9');
    } finally {
      warn.mockRestore();
    }
  });
});

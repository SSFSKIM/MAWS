// `logicalLines` against xterm's own buffer (@xterm/headless, the version the product's renderer draws): the rows and
// their soft-wrap flags as the renderer's probe reads them, at a width where the command wraps.
import { Terminal } from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { logicalLines } from './terminal-lines';

const COMMAND = 'echo PASTED-$((6*7))';

async function screenAfter(cols: number, data: string) {
  const terminal = new Terminal({ cols, rows: 6, allowProposedApi: true });
  await new Promise<void>((resolve) => terminal.write(data, resolve));
  const buffer = terminal.buffer.active;
  const rows = Array.from({ length: terminal.rows }, (_, row) => buffer.getLine(buffer.viewportY + row)!);
  const read = { cols, screen: rows.map((line) => line.translateToString(true)), wrapped: rows.map((line) => line.isWrapped) };
  terminal.dispose();
  return read;
}

describe('logicalLines', () => {
  it('joins a command wrapped right after its space, the space kept', async () => {
    const read = await screenAfter(10, `$ ab ${COMMAND}`); // `$ ab echo ` fills the first row
    expect(read.screen.slice(0, 3)).toEqual(['$ ab echo ', 'PASTED-$((', '6*7))']);
    expect(logicalLines(read)).toContain(`$ ab ${COMMAND}`);
  });

  it('joins a command wrapped after a prompt of wide characters, nothing added at the wrap', async () => {
    const read = await screenAfter(10, `abc你好${COMMAND}`);
    expect(read.screen.slice(0, 3)).toEqual(['abc你好ech', 'o PASTED-$', '((6*7))']);
    expect(read.wrapped.slice(0, 3)).toEqual([false, true, true]);
    expect(logicalLines(read)).toContain(`abc你好${COMMAND}`);
  });

  it('keeps a full row that ended in a hard newline apart from the row under it', async () => {
    const read = await screenAfter(10, '0123456789\r\nnext');
    expect(logicalLines(read).slice(0, 2)).toEqual(['0123456789', 'next']);
  });
});

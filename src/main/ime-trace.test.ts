import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { recordImeTrace, type TracedContents } from './ime-trace';

// A window's contents: its main frame, and console-message events naming the frame that logged them.
function contents() {
  const emitter = new EventEmitter();
  const mainFrame = { url: 'file:///app/index.html' };
  const fake = Object.assign(emitter, { mainFrame }) as unknown as TracedContents;
  const log = (frame: object, message: string) => emitter.emit('console-message', { message, frame });
  return { fake, mainFrame, log };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the IME trace file (temporary, P2-F S ime-trace)', () => {
  it("appends the main frame's [ime-trace] lines, in order, and nothing else", async () => {
    const { fake, mainFrame, log } = contents();
    const lines: string[] = [];
    recordImeTrace(fake, async (line) => void lines.push(line));
    log(mainFrame, '[ime-trace] 1.0 keydown key="ㅎ"');
    log(mainFrame, 'an ordinary log line');
    log(mainFrame, '[ime-trace] 2.0 onData ed 95 9c');
    await settled();
    expect(lines).toEqual(['[ime-trace] 1.0 keydown key="ㅎ"\n', '[ime-trace] 2.0 onData ed 95 9c\n']);
  });

  it('rejects a prefixed line from a subframe (a deliverable frame in the window)', async () => {
    const { fake, log } = contents();
    const lines: string[] = [];
    recordImeTrace(fake, async (line) => void lines.push(line));
    log({ url: 'maws-deliverable://d1/index.html' }, '[ime-trace] 1.0 onData 41');
    await settled();
    expect(lines).toEqual([]);
  });
});

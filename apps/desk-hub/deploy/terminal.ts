// The owner's terminal for `deployment admin`'s confirmations, the pairing code and a paper recovery key: /dev/tty
// against a deployment, so a shell with no controlling terminal (an agent's) cannot answer them; stdin and stdout at the
// suites' local hub. Nothing after a line is consumed.
//
// Neither is read by a blocking read on the main thread, so the event loop runs while the owner has not answered: a
// blocking read would hold Ctrl-C, a SIGHUP or a SIGTERM until a byte came (libuv restarts the read), and the run
// lock's handler (run-lock.ts), which removes the lock, with it. Nor on the threadpool: `process.exit` waits for a read
// in flight there. A terminal is read as /dev/tty, byte by byte, through a non-blocking descriptor of its own, polled,
// so the shell's descriptor keeps its flags; the prompt's writes keep a blocking one. That holds for a terminal on the
// local hub's stdin too (on macOS a process reading its terminal through Node's stream was seen not to end once the
// terminal hung up). A stdin that is no terminal (a pipe, a file) is read through Node's stream, what follows a line
// put back on it for the next reader.
import { closeSync, constants, openSync, readSync, writeSync } from 'node:fs';
import { isatty } from 'node:tty';

/** Where confirmations, the pairing code and a paper key go: /dev/tty against a deployment. */
export type Terminal = { write(text: string): void; readLine(): Promise<string> };

/** How long a read that finds nothing typed yet waits before it reads again. */
const POLL_MS = 50;

/** A line read from `fd` (non-blocking), byte by byte, so nothing after it is consumed; the end of input ends it. */
async function readLineFrom(fd: number): Promise<string> {
  const bytes: number[] = [];
  const one = Buffer.alloc(1);
  for (;;) {
    let n: number;
    try {
      n = readSync(fd, one, 0, 1, null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') throw error;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }
    // The end of input: a terminal that hung up reads so before its SIGHUP is handled, so the loop turns first, and
    // the handler (run-lock.ts) ends the run before anything acts on an empty answer.
    if (n === 0) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (n === 0 || one[0] === 0x0a) return Buffer.from(bytes).toString('utf8');
    bytes.push(one[0]);
  }
}

/** The terminal: /dev/tty for a deployment (throws when the shell has none), stdin and stdout for the local hub. */
export function openTerminal(deployment: boolean): Terminal {
  if (!deployment) {
    const write = (text: string) => void process.stdout.write(text);
    if (!isatty(0)) return { write, readLine: stdinLine };
    const input = ttyInput();
    return { write, readLine: () => readLineFrom(input) };
  }
  const output = openSync('/dev/tty', 'r+');
  process.once('exit', () => closeSync(output));
  const input = ttyInput();
  return { write: (text) => void writeSync(output, text), readLine: () => readLineFrom(input) };
}

/** /dev/tty, non-blocking, for reading: an open file description of its own. */
function ttyInput(): number {
  const input = openSync('/dev/tty', constants.O_RDONLY | constants.O_NONBLOCK);
  process.once('exit', () => closeSync(input));
  return input;
}

/** A line from `process.stdin`, what came after it in the same chunk unshifted; the end of input ends it. */
function stdinLine(): Promise<string> {
  const stdin = process.stdin;
  if (stdin.readableEnded) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    const done = () => {
      stdin.off('data', data);
      stdin.off('end', end);
      stdin.off('error', failed);
      stdin.pause();
    };
    const data = (chunk: Buffer) => {
      const at = chunk.indexOf(0x0a);
      if (at === -1) return void parts.push(chunk);
      done();
      if (at + 1 < chunk.length) stdin.unshift(chunk.subarray(at + 1));
      resolve(Buffer.concat([...parts, chunk.subarray(0, at)]).toString('utf8'));
    };
    const end = () => {
      done();
      resolve(Buffer.concat(parts).toString('utf8'));
    };
    const failed = (error: Error) => {
      done();
      reject(error);
    };
    stdin.on('data', data);
    stdin.once('end', end);
    stdin.once('error', failed);
    // A stream paused by the line before stays paused when a listener is added.
    stdin.resume();
  });
}

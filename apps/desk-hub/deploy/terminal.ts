// The owner's terminal for `deployment admin`'s confirmations, the pairing code and a paper recovery key: /dev/tty
// against a deployment, so a shell with no controlling terminal (an agent's) cannot answer them; stdin and stdout at the
// suites' local hub. A line is read byte by byte, so nothing after it is consumed: what follows stays on the
// descriptor for whatever reads it next.
//
// A terminal is never read by a blocking read on the main thread, so the event loop runs while the owner has not
// answered: a blocking read would hold Ctrl-C, a SIGHUP or a SIGTERM until a byte came (libuv restarts the read), and
// the run lock's handler (run-lock.ts), which removes the lock, with it. Nor on the threadpool: `process.exit` waits
// for a read in flight there. So a terminal, a deployment's or one on the local hub's stdin, is read as /dev/tty
// through a non-blocking descriptor of its own, polled, the shell's descriptor keeping its flags; the prompt's writes
// keep a blocking one (on macOS a process reading its terminal through Node's stream was seen not to end once the
// terminal hung up).
//
// A stdin that is no terminal (a pipe or a file, the suites' and a script's) is read with a blocking read of fd 0, as
// before: Node's stream would set O_NONBLOCK on the open file description a parent or sibling shares and read past
// the line, out of the next reader's reach. The accepted limit: a signal while such a prompt waits on a pipe that holds
// no answer yet is handled once data or the end of input comes, at the run's next turn of the event loop (its next
// request); the lock is removed then, or by the run's own end. That is the local hub's alone, and rare: a pipe
// carries its answer already, and the terminals, where an owner presses Ctrl-C, are interruptible.
import { closeSync, constants, openSync, readSync, writeSync } from 'node:fs';
import { isatty } from 'node:tty';

/** Where confirmations, the pairing code and a paper key go: /dev/tty against a deployment. */
export type Terminal = { write(text: string): void; readLine(): Promise<string> };

/** How long a read that finds nothing typed yet waits before it reads again. */
const POLL_MS = 50;

/** A line read from `fd`, byte by byte, so nothing after it is consumed; the end of input ends it. */
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
    if (!isatty(0)) return { write, readLine: () => readLineFrom(0) };
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

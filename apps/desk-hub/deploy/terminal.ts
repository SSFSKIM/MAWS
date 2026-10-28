// The owner's terminal for `deployment admin`'s confirmations, the pairing code and a paper recovery key: /dev/tty
// against a deployment, so a shell with no controlling terminal (an agent's) cannot answer them; stdin and stdout at the
// suites' local hub. A line is read byte by byte, so nothing typed after it is consumed.
//
// /dev/tty is read through a non-blocking descriptor of its own, polled, so the event loop runs while the owner has not
// answered: a blocking read would hold Ctrl-C, a SIGHUP or a SIGTERM until a byte came (libuv restarts the read), and
// the run lock's handler (run-lock.ts), which removes the lock, with it. The prompt's writes keep a blocking descriptor.
import { closeSync, constants, openSync, readSync, writeSync } from 'node:fs';

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
    if (n === 0 || one[0] === 0x0a) return Buffer.from(bytes).toString('utf8');
    bytes.push(one[0]);
  }
}

/** The terminal: /dev/tty for a deployment (throws when the shell has none), stdin and stdout for the local hub. */
export function openTerminal(deployment: boolean): Terminal {
  if (!deployment) return { write: (text) => void process.stdout.write(text), readLine: () => readLineFrom(0) };
  const output = openSync('/dev/tty', 'r+');
  const input = openSync('/dev/tty', constants.O_RDONLY | constants.O_NONBLOCK);
  process.once('exit', () => {
    closeSync(input);
    closeSync(output);
  });
  return { write: (text) => void writeSync(output, text), readLine: () => readLineFrom(input) };
}

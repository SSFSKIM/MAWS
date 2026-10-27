// The supervisor's log (E10 execution document, §Design 1 "The spawn"; P5 O2 M4: and the pty host's in socket mode):
// `<dir>/host.log`, one timestamped line per entry, rotated at 8 MiB to `host.log.1` (one previous generation). Main
// opens the same file for append as the supervisor's stdout and stderr, so stray output lands beside it; the detached
// entry routes `console` here, so the host's own logging follows the rotation. Diagnostics offers "Open log" on it.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SUPERVISOR_FILES } from './supervisor-files';

export const LOG_ROTATE_BYTES = 8 * 1024 * 1024;

// P5 O2 M4: a missing directory is created 0700; an existing one is left as it is, since the log opens before the
// start's private-directory check (@shared/host/private-listen), which refuses one more open than 0700 rather than
// correcting it.
// P5 O2 M5: `name` for another process's log in its own directory (`mawsd.log`).
export function openSupervisorLog(dir: string, maxBytes: number = LOG_ROTATE_BYTES, name: string = SUPERVISOR_FILES.log): (line: string) => void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  let size = sizeOf(path);
  return (line) => {
    const text = `${new Date().toISOString()} ${line}\n`;
    const bytes = Buffer.byteLength(text);
    try {
      if (size > 0 && size + bytes > maxBytes) {
        renameSync(path, `${path}.1`);
        size = 0;
      }
      appendFileSync(path, text, { mode: 0o600 });
      size += bytes;
    } catch {
      // a log that cannot be written must not take the supervisor down
    }
  };
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

// The supervisor's socket directory under the user's tmpdir, which a profile whose own socket path is too long for
// sun_path uses instead (`socketPathFor` in src/engine-host/supervisor-files.ts). A case's cleanup removes a socket's
// directory only when it is exactly this profile's fallback, so a run that ignored its scratch userData can never
// remove the owner's supervisor directory.
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// The directory of `socketPath` when it is the tmpdir fallback of `userData`'s supervisor, resolved; else null.
export function tmpSocketDirOf(userData: string, socketPath: string): string | null {
  if (basename(socketPath) !== 'host.sock') return null;
  const fallback = join(realpathSync(tmpdir()), `maws-supervisor-${createHash('sha1').update(userData).digest('hex').slice(0, 12)}`);
  try {
    return realpathSync(dirname(socketPath)) === fallback ? fallback : null;
  } catch {
    return null; // already gone
  }
}

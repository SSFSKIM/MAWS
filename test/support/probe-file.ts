import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Establish ownership exclusively, then cover launch and the whole probe with cleanup.
export async function withProbeFile<T>(root: string, content: string, run: (path: string) => Promise<T>): Promise<T> {
  const path = join(root, `c8c-live-probe-${randomUUID()}.txt`);
  writeFileSync(path, content, { flag: 'wx' });
  try {
    return await run(path);
  } finally {
    rmSync(path, { force: true });
  }
}

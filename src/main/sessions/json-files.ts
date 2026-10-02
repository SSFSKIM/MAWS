// Main's small JSON files under `userData` (C10's intents, bootstrap notes and deletion manifests): one file per id,
// written temp-then-rename in the same directory so a reader sees a whole file or none, and read back leniently (a
// file that does not parse is reported and left on disk for a person to look at).
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { atomicWriteFile } from '../files/atomic-write';
import { join } from 'node:path';

// An id names a file here, so it is one plain path component (the ids are UUIDs; anything else is refused).
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function fileOf(dir: string, id: string): string {
  if (!SAFE_ID.test(id) || id.includes('..')) throw new Error(`not a file-safe id: ${id}`);
  return join(dir, `${id}.json`);
}

export async function writeWhole(dir: string, id: string, value: unknown): Promise<void> {
  const target = fileOf(dir, id);
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

// Every `<id>.json` in `dir` (temp files and anything else ignored), parsed; a file that does not parse is skipped with
// a warning and left on disk for a person to look at.
export async function readAll(dir: string, warn: (message: string) => void): Promise<{ id: string; value: unknown }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const out: { id: string; value: unknown }[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    try {
      out.push({ id: name.slice(0, -'.json'.length), value: JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown });
    } catch (error) {
      warn(`${join(dir, name)} could not be read (${error instanceof Error ? error.message : String(error)}); skipped`);
    }
  }
  return out;
}

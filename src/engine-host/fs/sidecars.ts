// Whole-file JSON sidecars under the config home (C4 execution document, "Filesystem service internals"; charter
// residue *Sidecar write-atomicity retry*). `custom-title.json`, `agent-*.meta.json`, `wf_*.json`, `tasks/*/*.json`,
// `sessions/*.json` and `jobs/*/state.json` are written without a documented atomic rename (SPEC 35.10, 35.27.1,
// 20.2.4, 40.16), so a reader can see a truncated or half-written file: it reads, parses and checks again on a fixed
// schedule until the value is whole. Read-only: this module never opens anything for writing.
import { readFile } from 'node:fs/promises';

// Attempt times, in ms after the change that asked for the read (absolute offsets, not gaps).
export const RETRY_SCHEDULE_MS = [0, 20, 50, 100, 250, 500] as const;

// Reads the whole file, `JSON.parse`s it, maps it through `parse` (which throws on a shape it refuses) and applies
// `accept`; a failure at any step waits for the next attempt, and after the sixth it resolves `null` so the caller
// keeps its previous value. A file that does not exist resolves `null` at once: the engine's writers never make a
// file vanish mid-write (`writeFile` truncates in place; a rename replaces atomically), so absence is an answer.
export async function readJsonWithRetry<T>(path: string, parse: (raw: unknown) => T, accept?: (value: T) => boolean): Promise<T | null> {
  const started = Date.now();
  for (const at of RETRY_SCHEDULE_MS) {
    const wait = started + at - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const value = parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
      if (accept === undefined || accept(value)) return value;
    } catch (error) {
      if (isMissing(error)) return null;
    }
  }
  return null;
}

export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

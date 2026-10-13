// Tests' edits of a fixture token file: a deep copy with each change applied at a key path; `undefined` deletes.
export type Edit = readonly [path: string, value: unknown];

/** `edited(file, ['color/status/info', undefined], ['motion/fast/$type', 'time'])`: paths split on `/` (names hold `.`). */
export function edited(file: unknown, ...edits: Edit[]): Record<string, unknown> {
  const copy = structuredClone(file) as Record<string, unknown>;
  for (const [path, value] of edits) {
    const keys = path.split('/');
    let node = copy;
    for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
    if (value === undefined) delete node[keys.at(-1)!];
    else node[keys.at(-1)!] = value;
  }
  return copy;
}

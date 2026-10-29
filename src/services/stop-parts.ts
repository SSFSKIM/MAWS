// A root's one stop over its parts (P5 O3-C, D21): every part is attempted, in order, whatever an earlier one threw,
// as main's shutdown steps did when each part was a step of its own (src/main/lifecycle/shutdown.ts); each failure is
// logged with the part's name, and the stop itself never throws.
export type Part = readonly [name: string, stop: () => void];

export function stopParts(root: string, parts: readonly Part[], log: (line: string, error: unknown) => void = (line, error) => console.error(line, error)): void {
  for (const [name, stop] of parts) {
    try {
      stop();
    } catch (error) {
      log(`[shutdown] ${root}: ${name} failed; going on`, error);
    }
  }
}

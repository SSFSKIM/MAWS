// `mawsd`'s Node floor (P5 O2 M8; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The Linux runtime and the Node
// floor"): Node 24.11.0, the first 24 LTS, which has `node:sqlite` without a flag (O3's index), type stripping on by
// default (`apps/org-protocol` unbundled) and `--disable-sigusr1`. A unit daemon asserts it at start (index.ts), since a
// unit names its runtime in a file that outlives the build that wrote it; the pack's smoke check (scripts/mawsd-pack.mjs)
// proves the Linux runtime meets it before a release is made.
export const NODE_FLOOR = '24.11.0';

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)/;

// Why `version` (process.versions.node, with or without its `v`) is below the floor, or null when it meets it.
export function nodeFloorProblem(version: string): string | null {
  const have = VERSION.exec(version);
  if (!have) return `mawsd cannot read the Node version ${JSON.stringify(version)}; it needs Node ${NODE_FLOOR} or newer`;
  const need = VERSION.exec(NODE_FLOOR)!;
  for (let i = 1; i <= 3; i++) {
    const [a, b] = [Number(have[i]), Number(need[i])];
    if (a > b) return null;
    if (a < b) return `mawsd needs Node ${NODE_FLOOR} or newer; this is Node ${version.replace(/^v/, '')}`;
  }
  return null;
}

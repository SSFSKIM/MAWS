// P5 O10 M10 (the architect's ruling on acceptance 14): `mawsd` loads its endpoint from a chunk the build emits beside
// it, deferred (endpoint-seam.ts), so a release that left a chunk out would start, serve and fail only at the first
// endpoint command. The Linux pack (scripts/mawsd-pack.mjs, `pnpm mawsd:pack`) packed from this build: its mawsd.js is
// a guarded entry inside the pack's own out/ (test/support/guarded-entry.ts), every chunk its graph names, deferred ones
// included, at the path the build gave it, and the endpoint's among them. Packed without the Linux runtime (its
// download is O2's own suite's, scripts/mawsd-pack.test.mjs); what the pack copies of out/ is the same on every
// platform. Skipped without a build, as the bundle guard is.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { guardedEntryProblems, loadsOf, runPathOf } from '../../test/support/guarded-entry';

const REPO = resolve(__dirname, '../..');
const MAWSD = join(REPO, 'out/main/mawsd.js');
const ENDPOINT_MARKER = 'endpoint: refusing its state'; // endpoint.ts's own log line, as the bundle guard reads it
const EXTERNALS = ['zod', '@modelcontextprotocol/sdk']; // the engine host's, which mawsd's own graph may require

const scratch = mkdtempSync(join(tmpdir(), 'maws-pack-chunks-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Every file the entry's graph names, deferred loads followed too, relative to `out`. */
function graphOf(entry: string, out: string): string[] {
  const files = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file) || !existsSync(file)) return;
    files.add(file);
    for (const load of loadsOf(file, readFileSync(file, 'utf8')).loads) if (load.specifier.startsWith('.')) visit(resolve(file, '..', load.specifier));
  };
  visit(entry);
  return [...files].map((file) => relative(out, file)).sort();
}

describe.skipIf(!existsSync(MAWSD))('the Linux pack of this build', () => {
  it('carries every chunk mawsd’s graph names, deferred ones included, the endpoint’s among them', () => {
    // The output directory by the environment: the script reads its own argv[1] to tell whether it was run as one.
    const script = "import { pack } from './scripts/mawsd-pack.mjs'; process.stdout.write(await pack({ build: false, platform: 'darwin', out: process.env.PACK_OUT, log() {} }))";
    const at = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, encoding: 'utf8', env: { ...process.env, PACK_OUT: join(scratch, 'dist') } });
    const packed = join(at, 'out/main/mawsd.js');
    const allowed = (name: string) => name.startsWith('node:') || builtinModules.includes(name) || EXTERNALS.some((external) => name === external || name.startsWith(`${external}/`));
    expect(guardedEntryProblems({ entry: packed, root: join(at, 'out'), externals: allowed, deferred: true })).toEqual([]);

    const built = graphOf(MAWSD, join(REPO, 'out'));
    expect(graphOf(packed, join(at, 'out'))).toEqual(built);
    // The endpoint's chunk is one the run path never names: a pack that carried the run path alone would leave it out.
    const deferred = built.filter((file) => !runPathOf(MAWSD).has(join(REPO, 'out', file)));
    expect(deferred.filter((file) => readFileSync(join(at, 'out', file), 'utf8').includes(ENDPOINT_MARKER))).toHaveLength(1);
  }, 60_000); // the pack copies out/main and the externals' closure, about 120 MB: 3 s here, far longer on a loaded machine
});

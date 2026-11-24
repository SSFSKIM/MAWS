// P5 O10 M10 (the architect's ruling on acceptance 14): `mawsd` loads its endpoint from a chunk the build emits beside
// it, deferred (endpoint-seam.ts), so a release that left a chunk out would start, serve and fail only at the first
// endpoint command. The Linux pack (scripts/mawsd-pack.mjs, `pnpm mawsd:pack`) packed from this build: its mawsd.js is
// a guarded entry inside the pack's own out/ (test/support/guarded-entry.ts), every chunk its graph names, deferred ones
// included, at the path the build gave it, and the endpoint's among them. Packed without the Linux runtime (its
// download is O2's own suite's, scripts/mawsd-pack.test.mjs); what the pack copies of out/ is the same on every
// platform. Skipped without a build, as the bundle guard is.
//
// The question sheet's C4 (T23): packed with `page: false` (`--no-page`), since the unit job builds main alone and a
// page some earlier build left must not decide the test; a mawsd run from such a pack, told to serve the page, reads
// `no-bundle` and opens no port.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { guardedEntryProblems, loadsOf, runPathOf } from '../../test/support/guarded-entry';
import { RawApp, until } from '../../test/support/mawsd-scene';

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

// The pack of this build, made once: the output directory by the environment, since the script reads its own argv[1]
// to tell whether it was run as one
let made: string | null = null;
function packOfThisBuild(): string {
  const script = "import { pack } from './scripts/mawsd-pack.mjs'; process.stdout.write(await pack({ build: false, page: false, platform: 'darwin', out: process.env.PACK_OUT, log() {} }))";
  return (made ??= execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, encoding: 'utf8', env: { ...process.env, PACK_OUT: join(scratch, 'dist') } }));
}

describe.skipIf(!existsSync(MAWSD))('the Linux pack of this build', () => {
  it('carries every chunk mawsd’s graph names, deferred ones included, the endpoint’s among them', () => {
    const at = packOfThisBuild();
    const packed = join(at, 'out/main/mawsd.js');
    const allowed = (name: string) => name.startsWith('node:') || builtinModules.includes(name) || EXTERNALS.some((external) => name === external || name.startsWith(`${external}/`));
    expect(guardedEntryProblems({ entry: packed, root: join(at, 'out'), externals: allowed, deferred: true })).toEqual([]);

    const built = graphOf(MAWSD, join(REPO, 'out'));
    expect(graphOf(packed, join(at, 'out'))).toEqual(built);
    // The endpoint's chunk is one the run path never names: a pack that carried the run path alone would leave it out.
    const deferred = built.filter((file) => !runPathOf(MAWSD).has(join(REPO, 'out', file)));
    expect(deferred.filter((file) => readFileSync(join(at, 'out', file), 'utf8').includes(ENDPOINT_MARKER))).toHaveLength(1);
  }, 60_000); // the pack copies out/main and the externals' closure, about 120 MB: 3 s here, far longer on a loaded machine

  it('holds no page under --no-page, and its mawsd, told to serve the page, reads no-bundle', async () => {
    const at = packOfThisBuild();
    expect(existsSync(join(at, 'out/sheet-page'))).toBe(false);
    const profile = join(scratch, 'profile');
    mkdirSync(join(profile, 'home'), { recursive: true });
    // the page on, on a port the system picks, under a scratch home: were the bundle there, it would listen
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(profile, 'home'), MAWS_USER_DATA: profile, SMINOS_HOME: join(profile, 'sminos'), MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0' };
    const mawsd = spawn(process.execPath, ['--disable-sigusr1', join(at, 'out/main/mawsd.js'), 'run', '--private', '--dir', join(profile, 'mawsd')], { env, stdio: 'ignore' });
    const exited = new Promise<number | null>((done) => mawsd.once('exit', (code) => done(code)));
    try {
      const log = () => (existsSync(join(profile, 'mawsd/mawsd.log')) ? readFileSync(join(profile, 'mawsd/mawsd.log'), 'utf8') : '');
      await until(() => log().includes(' serving;') || mawsd.exitCode !== null, 20_000, () => `mawsd to serve:\n${log()}`);
      const machine = await RawApp.connect(join(profile, 'mawsd/machine.sock'), readFileSync(join(profile, 'mawsd/mawsd.token'), 'utf8').trim());
      let page: { state?: string; detail?: string | null } = {};
      for (const end = Date.now() + 10_000; page.detail == null && Date.now() < end; await new Promise((wake) => setTimeout(wake, 50))) {
        page = ((await machine.request('daemon.status')).value as { sheetPage: typeof page }).sheetPage;
      }
      machine.destroy();
      expect(page).toMatchObject({ state: 'no-bundle', detail: 'this build holds no sheet page' });
    } finally {
      mawsd.kill('SIGTERM');
      await exited;
    }
  }, 60_000);
});

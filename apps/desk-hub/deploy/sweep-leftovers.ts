// `deployment sweep-leftovers <name>…`: the reach harness's own undo, for the scene and probe machines a run left listed
// on staging when its cleanup could not finish (a CLI token revoked mid-run, a killed process). Each machine named is
// taken out of the org state with its key retired (OrgAdmin.unlist) and its hub credential revoked (proof.ts's revoke),
// as the harness's enrollListed cleanup does. Staging alone, and only names of the reach run's shape
// (`o18-<scene or probe>-<tag>`), so no other machine can be named to it.
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { checkTestHub, PRODUCTION_HOST, readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { Person } from './hub';
import { loadAdminDevice, OrgAdmin } from './org-admin';
import { isTestTarget, revoke } from './proof';

/** The names the reach run gives its machines: a scene's (a1, a2, a3, b1) or a probe's (pa, pb), then the run's tag. */
export const LEFTOVER = /^o18-(a1|a2|a3|b1|pa|pb)-[0-9a-f]{6}$/;

/** The names to sweep, or why the command line is refused: staging's config alone, a device's keys, and every name
 * one of the reach run's, checked before a secret is read or anything reaches the hub. */
export function sweepMode(values: { 'device-keys'?: string }, names: readonly string[], config: { worker: string; host: string }): { names: string[] } | { refused: string } {
  if (config.host === PRODUCTION_HOST || config.worker === 'desk-hub') return { refused: `the config names production (${config.host}): sweep-leftovers runs on staging alone` };
  if (!values['device-keys']) return { refused: '--device-keys <file>: the staging admin device whose step-up key signs the org state' };
  if (names.length === 0) return { refused: 'sweep-leftovers <o18-…-xxxxxx>…: name the reach run’s scene or probe machines to sweep' };
  const others = names.filter((n) => !LEFTOVER.test(n));
  if (others.length) return { refused: `not a reach run’s machine name (o18-<a1|a2|a3|b1|pa|pb>-<6 hex>): ${others.join(', ')}` };
  return { names: [...new Set(names)] };
}

/** One name's two undoings: `unlist` takes it out of the org state and says what it found there, `revoke` revokes its hub
 * credential. */
export type SweepSteps = { unlist: (name: string) => Promise<string>; revoke: (name: string) => Promise<void> };

/** One name swept, true when both its steps held. The unlisting and the revoking are attempted each on its own, as the
 * harness registers them as two cleanup steps: a head that cannot be read or signed leaves the hub credential no less
 * usable, so it is revoked all the same. */
export async function sweepName(name: string, steps: SweepSteps, print: (line: string) => void): Promise<boolean> {
  let held = true;
  try {
    print(`${name}: ${await steps.unlist(name)}`);
  } catch (error) {
    held = false;
    print(`${name}: FAILED taking it out of the org state: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await steps.revoke(name);
    print(`${name}: its hub credential revoked`);
  } catch (error) {
    held = false;
    print(`${name}: FAILED revoking its hub credential: ${error instanceof Error ? error.message : String(error)}`);
  }
  return held;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { config: { type: 'string' }, 'device-keys': { type: 'string' } }, allowPositionals: true });
  const config = readDeployConfig((values.config as string | undefined) ?? join(process.env.DESK_HUB_APP!, 'deploy', 'staging.json'));
  const mode = sweepMode(values, positionals, config);
  if ('refused' in mode) {
    console.error(mode.refused);
    return 2;
  }
  if (!isTestTarget(config)) return 2;
  const read = await readSecrets();
  if (!read.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  const person = new Person(`https://${config.host}`, read.DESK_ACCESS_TOKEN, () => {}, { requestMs: 30_000 });
  checkTestHub(person.hub, 'sweep the reach runs’ leftovers from it');
  const admin = await OrgAdmin.open(person, { org: config.org.id, pinnedGenesis: config.orgGenesis }, await loadAdminDevice(values['device-keys'] as string), (line) => console.log(line));
  const unlist = async (name: string): Promise<string> => {
    const { state } = await admin.read();
    const machine = state.machines.find((m) => m.name === name);
    if (machine === undefined) return `not listed in the head (version ${state.version})`;
    const signed = await admin.unlist({ name: machine.name, ref: machine.ref, key: { pub: machine.pub } });
    return signed === null ? 'already out' : `taken out, its key retired (version ${signed.state.version})`;
  };
  let failed = 0;
  for (const name of mode.names) {
    if (!(await sweepName(name, { unlist, revoke: (n) => revoke(person, n) }, (line) => console.log(line)))) failed += 1;
  }
  return failed ? 1 : 0;
}

// `deployment acceptance`: O11's acceptance items that no other command proves (O11 M8), run against a deployment by the
// test device as the org's admin (org-admin.ts), each check one line a person can read and the whole re-runnable:
//   2  a successor off the head refused `not-head` and an older one `rollback`; a member added, and their second device
//      admitted only endorsed by their first and root-signed; a provisioning key re-issued as a delegation enrolls a
//      VM whose certificate the hub serves beside the state;
//   3  1 000 frames of 1 B to 256 KiB cross a channel byte-identical and in order, and a message over 1 MiB is refused;
//   4  v2-only, dual-coded and v1 events are stored; a bad signature, or a key the state does not list for the writer,
//      is refused `bad-signature`; a byte-identical resend is a duplicate and a re-signed one a `conflict` — from the
//      machine and from the device;
//   5  a `notify` reaches the listed owner's device alone, carrying only {project, machine, session, kind};
//   6  the reference client holds the Registry, Project and Machine sockets as the device's member.
// Items 3–6 share one v2 machine the admin enrolls and lists, whose endpoint holds RL1 and opens one project.
//
// What it changes in the org state is undone by signed successors before it ends, however it ends, a SIGINT or SIGTERM
// included (proof.ts, interruptible): the machines leave the state (their keys retired) and are revoked, the delegation
// is dropped (its key revoked; its id and prefix stay reserved for good, RL DL 26), the provisioning key revoked, the
// push subscription deleted; then the head is read back to show none of it current. What outlives the run is named in
// deploy/README.md.
//
// stdin (readSecrets): DESK_ACCESS_TOKEN, the owner's Access app token. Options: --device-keys <file> (required: the
// admin device, whose channel key also signs the device's words and binds the push), --items (default 2,3,4,5,6),
// --frames (acceptance 3's count, default 1000), --push-url <https base> with --push-port <port> (acceptance 5's sink:
// a public https URL that reaches 127.0.0.1:<port>; without them item 5 is skipped), --test-org <id> (a throwaway org
// instead of the configuration's own, whose pinned genesis is otherwise required).
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { SignedOrgState } from 'org-protocol';
import { readDeployConfig } from './config';
import { deployArgs, readSecrets } from './deploy';
import { Person, settledWithin } from './hub';
import { connection, delegation, events, frames, lingering, members, push, Report, type Context, type Fixture } from './acceptance-items';
import { loadAdminDevice, OrgAdmin, type AdminDevice, type OrgScope } from './org-admin';
import { Cleanup, interruptible, isTestTarget, STEP_MS, testOrgArg, type InterruptOptions } from './proof';
import { httpPushSink, type PushSink } from './push-sink';
import { connectEndpoint, echoingEndpoint } from './rl1';

export const ITEMS = ['2', '3', '4', '5', '6'];

export type AcceptanceOptions = { items: string[]; frames: number; sink?: PushSink };

/** Items 3–6's machine: enrolled and listed by the admin, its endpoint on RL1 with one project opened. */
async function fixture(ctx: Context): Promise<Fixture> {
  const name = `m8-ep-${ctx.tag}`;
  ctx.made.machines.push(name);
  const machine = await ctx.admin.listedMachine(name, ctx.cleanup);
  const endpoint = echoingEndpoint(ctx.person.hub, machine, { build: 'acceptance' });
  ctx.cleanup.add(`close ${name}'s endpoint`, async () => endpoint.close());
  await connectEndpoint(endpoint);
  const project = randomUUID();
  await endpoint.project(project, `o11 m8 acceptance ${ctx.tag}`);
  return { machine, endpoint, project };
}

/**
 * The run: the items asked for, in order, each check reported as it ends. Everything it makes is undone through
 * `cleanup`, which the caller runs; `made` names it for the check after.
 */
export async function acceptance(
  person: Person,
  scope: OrgScope,
  device: AdminDevice,
  options: AcceptanceOptions,
  cleanup: Cleanup,
  print: (line: string) => void = console.log,
  made: Context['made'] = { machines: [], delegations: [], provisioningPrefixes: [], members: [] },
): Promise<{ report: Report; made: Context['made'] }> {
  const report = new Report(print, cleanup.signal);
  const admin = await OrgAdmin.open(person, scope, device, print);
  const ctx: Context = { person, admin, cleanup, report, tag: Math.random().toString(36).slice(2, 7), made };
  print(`acceptance: ${person.hub}, org ${admin.org} at head version ${admin.head.state.version}, device ${device.id} of ${admin.member}; items ${options.items.join(', ')}`);
  if (options.items.includes('2')) {
    await members(ctx);
    await delegation(ctx);
  }
  const rest = options.items.filter((item) => item !== '2');
  if (rest.length === 0) return { report, made };
  let shared: Fixture | undefined;
  await report.check('3-6', 'a listed v2 machine on RL1', async () => {
    shared = await fixture(ctx);
    return `${shared.machine.name} (ref ${shared.machine.ref}) listed for ${admin.member}, its endpoint on RL1 under generation ${shared.endpoint.generation}, project ${shared.project} opened`;
  });
  if (!shared) return { report, made };
  if (rest.includes('3')) await frames(ctx, shared, options.frames);
  if (rest.includes('4')) await events(ctx, shared, device);
  if (rest.includes('5')) await push(ctx, shared, device, options.sink);
  if (rest.includes('6')) await connection(ctx, shared, device, options.sink?.endpoint(`o11-m8-${ctx.tag}-reference`) ?? `https://push.invalid/o11-m8-${ctx.tag}`);
  return { report, made };
}

/** After the cleanup: the head and the hub's lists read back, so the run shows it left none of its own current. */
export async function afterCleanup(person: Person, made: Context['made'], signal?: AbortSignal): Promise<string[]> {
  const { head } = await person.json<{ head: SignedOrgState | null }>('/api/org/state', { signal });
  const problems = head ? lingering(head.state, made) : [];
  const { machines } = await person.json<{ machines: Array<{ name: string }> }>('/api/machines', { signal });
  problems.push(...machines.filter((m) => made.machines.includes(m.name)).map((m) => `the hub still holds the machine ${m.name}`));
  const { keys } = await person.json<{ keys: Array<{ id: string; prefix: string; revoked?: string | null }> }>('/api/provisioning-keys', { signal });
  problems.push(...keys.filter((k) => made.provisioningPrefixes.includes(k.prefix) && !k.revoked).map((k) => `the provisioning key ${k.id} (prefix ${k.prefix}) is not revoked`));
  return problems;
}

/** How long the steps after the cleanup may take, each: the push sink's close and the read-back, whose stalled reads
 * are aborted at it, so an interrupted command still ends. */
export const AFTER_CLEANUP_MS = STEP_MS;

/**
 * The acceptance run as the command makes it, under `interruptible`: the items, then however the run ends (a signal
 * included) the cleanup, the push sink closed, and the head and the hub's lists read back for anything of the run's
 * still current. The command's status. `person`'s requests should pass `cleanup.check`, so an interrupted run's stop.
 */
export function runAcceptance(
  person: Person,
  scope: OrgScope,
  device: AdminDevice,
  options: AcceptanceOptions,
  cleanup: Cleanup,
  print: (line: string) => void = console.log,
  { afterCleanupMs = AFTER_CLEANUP_MS, ...interrupt }: InterruptOptions & { afterCleanupMs?: number } = {},
): Promise<number> {
  const made: Context['made'] = { machines: [], delegations: [], provisioningPrefixes: [], members: [] };
  return interruptible(
    cleanup,
    async () => ((await acceptance(person, scope, device, options, cleanup, print, made)).report.ok ? 0 : 1),
    async (status) => {
      const failed = await cleanup.run();
      const closing = options.sink?.close();
      if (closing) await settledWithin(closing, afterCleanupMs);
      const left = await afterCleanup(person, made, AbortSignal.timeout(afterCleanupMs)).catch((error: unknown) => [
        `the check after cleanup failed: ${error instanceof Error && error.name === 'TimeoutError' ? `no answer within ${afterCleanupMs / 1000} s` : error instanceof Error ? error.message : String(error)}`,
      ]);
      for (const line of left) print(`LEFT ${line}`);
      if (left.length === 0) print('cleanup: the head lists none of the run’s members, machines or delegations, the hub holds none of its machines, and its provisioning key is revoked');
      const code = failed.length || left.length ? 1 : status;
      print(`acceptance: ${code === 0 ? 'PASS' : 'FAIL'}`);
      return code;
    },
    interrupt,
  );
}

export async function main(argv: string[]): Promise<number> {
  const { config, values } = deployArgs(argv, {
    'device-keys': { type: 'string' },
    'test-org': { type: 'string' },
    items: { type: 'string', default: ITEMS.join(',') },
    frames: { type: 'string', default: '1000' },
    'push-url': { type: 'string' },
    'push-port': { type: 'string' },
  });
  if (!isTestTarget(config)) return 2;
  const items = (values.items as string).split(',').map((item) => item.trim());
  const frameCount = Number(values.frames);
  const port = values['push-port'] === undefined ? undefined : Number(values['push-port']);
  const problems = [
    !values['device-keys'] && '--device-keys <file> is required: the admin device whose step-up key signs the org state',
    items.some((item) => !ITEMS.includes(item)) && `--items names items among ${ITEMS.join(',')}`,
    !(Number.isSafeInteger(frameCount) && frameCount >= 2) && '--frames is an integer of at least 2',
    (values['push-url'] === undefined) !== (port === undefined) && '--push-url and --push-port go together',
    port !== undefined && !(Number.isSafeInteger(port) && port > 0 && port < 65536) && '--push-port is a port number',
  ].filter(Boolean);
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    return 2;
  }
  let scope: OrgScope = { org: config.org.id, pinnedGenesis: config.orgGenesis };
  if (values['test-org'] !== undefined) {
    const own = readDeployConfig((values.config as string | undefined) ?? join(process.env.DESK_HUB_APP!, 'deploy', 'config.json')).org.id;
    const org = testOrgArg(values['test-org'] as string, own);
    if (!org) return 2;
    scope = { org, throwaway: true };
  }
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  const device = await loadAdminDevice(values['device-keys'] as string);
  const cleanup = new Cleanup();
  const person = new Person(`https://${config.host}`, secrets.DESK_ACCESS_TOKEN, () => cleanup.check());
  const sink = port === undefined ? undefined : await httpPushSink(port, values['push-url'] as string);
  return runAcceptance(person, scope, device, { items, frames: frameCount, sink }, cleanup);
}

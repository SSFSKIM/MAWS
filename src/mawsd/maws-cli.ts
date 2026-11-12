// `maws project …` (docs/doperpowers/plans/2026-11-10-project-registry.md, M12, Interfaces §K; design §7): the `mawsd`
// program started with `maws` as its first argument, a thin front on the daemon's machine.sock. It finds its daemon as
// sminos finds its endpoint: `--profile`, else MAWS_USER_DATA, else the platform's default profile, so on a machine with
// several profiles the two speak to the same one (design §17).
//
// On this machine's own folders a verb is the index's command (`session.projects.addFolder`, `.update`, `.remove`,
// `.link`, `.resolve`), with the profile's token alone. `list`, `show` and the resolution of `--into` read the org's
// projects from the daemon (`projects.registry`, the endpoint's held records and the machine's own), so they work on a VM
// with no app. A target on another machine (`mini:/srv/scrape`) goes to the attached app through the daemon
// (`projects.forward`), since only a member's device can sign an act for another machine; the app's answer is printed.
// A `MACHINE:PATH` that names an existing path here is that local path, and one naming this machine is acted on here.
// Exit codes are `mawsd`'s: 0 done, 1 failed or refused, 2 not available here, 3 the daemon is not running.
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { daemonPaths } from '@shared/daemon/files';
import { defaultProfileDir } from '@shared/daemon/profile';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { ProjectForwardResult, ProjectsRegistry } from '@shared/ipc/schema/projects';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import { actRefusal, addWords, canonicalPath, contestedMachine, exitOf, hasParentSegment, linkWords, notCanonical, removeWords } from '@shared/machine/maws-words';
import { machineNameKey } from '../../apps/org-protocol/src/names.ts';
import { EXIT, type CliDeps } from './cli';
import { reachMachine, type MachineLink, type Reached } from './machine-client';

export const MAWS_USAGE = `usage: maws project <command> [--profile <dir>]
  add    [DIR | MACHINE:PATH] [--into <project>] [--new] [--name <name>]
  list   [--json]
  show   [DIR] [--json]
  remove [DIR | MACHINE:PATH]
  link   [DIR | MACHINE:PATH] (--into <project> | --none)
DIR is the working directory by default; MACHINE:PATH is a machine's name in the org and an absolute path there.
<project> is a project's id or name. Exit codes: 0 done, 1 failed or refused, 2 not available here, 3 mawsd not running`;

// A declaration answers after sminos's acknowledgement (at most RESTATE_WAIT_MS) and its git reads; a request aimed at
// another machine waits for a person in the app, while both connections live, so its bound only ends a daemon that
// never answers.
const ACT_TIMEOUT_MS = 60_000;
const FORWARD_TIMEOUT_MS = 24 * 3_600_000;

export type MawsDeps = Pick<CliDeps, 'env' | 'platform' | 'home' | 'cwd' | 'out' | 'err' | 'build'> & {
  /** The daemon's machine.sock (machine-client.ts's `reachMachine` unless a test gives a stand-in). */
  reach?(paths: ReturnType<typeof daemonPaths>): Promise<Reached>;
};

class Usage extends Error {}
/** A refusal this command makes itself: its words on stderr, exit 1. */
class Refused extends Error {}

type Verb = 'add' | 'list' | 'show' | 'remove' | 'link';
type Target = { local: string } | { machine: string; path: string };
type Parsed = { verb: Verb; target: string | undefined; into?: string; none?: true; own?: true; name?: string; json?: true };

export async function runMaws(argv: readonly string[], deps: MawsDeps): Promise<number> {
  try {
    const { rest, profile } = profileOption(argv);
    if (rest[0] !== 'project') throw new Usage(rest[0] === undefined ? 'maws needs a command' : `maws has no command ${rest[0]}`);
    const parsed = parse(rest.slice(1));
    const envProfile = deps.env.MAWS_USER_DATA || undefined;
    const profileDir = profile !== undefined ? resolve(deps.cwd, profile) : envProfile !== undefined ? resolve(deps.cwd, envProfile) : defaultProfileDir(deps.platform, deps.env, deps.home);
    const reached = await (deps.reach ?? ((paths) => reachMachine(paths, { build: deps.build })))(daemonPaths(profileDir));
    if (!reached.ok) {
      if (reached.state === 'incompatible') return failed(deps, reached.why);
      deps.err(`mawsd is not running (${reached.why})\n`);
      return EXIT.notRunning;
    }
    try {
      return await run(reached.link, parsed, deps);
    } finally {
      reached.link.close();
    }
  } catch (error) {
    if (error instanceof Usage) {
      deps.err(`${error.message}\n${MAWS_USAGE}\n`);
      return EXIT.failed;
    }
    return failed(deps, error instanceof Error ? error.message : String(error));
  }
}

// --- arguments ---------------------------------------------------------------------------------------------------------

function profileOption(argv: readonly string[]): { rest: string[]; profile?: string } {
  const rest: string[] = [];
  let profile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--profile') {
      rest.push(argv[i]!);
      continue;
    }
    profile = argv[++i];
    if (!profile) throw new Usage('--profile needs a value');
  }
  return { rest, ...(profile !== undefined && { profile }) };
}

const VERBS: Record<Verb, { target: boolean; valued: string[]; bare: string[] }> = {
  add: { target: true, valued: ['--into', '--name'], bare: ['--new'] },
  list: { target: false, valued: [], bare: ['--json'] },
  show: { target: true, valued: [], bare: ['--json'] },
  remove: { target: true, valued: [], bare: [] },
  link: { target: true, valued: ['--into'], bare: ['--none'] },
};

function parse(args: readonly string[]): Parsed {
  const [verb, ...rest] = args;
  if (verb === undefined) throw new Usage('maws project needs a command');
  if (!Object.hasOwn(VERBS, verb)) throw new Usage(`maws project has no command ${verb}`);
  const spec = VERBS[verb as Verb];
  const parsed: Parsed = { verb: verb as Verb, target: undefined };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (spec.valued.includes(arg)) {
      const value = rest[++i];
      if (value === undefined || value === '') throw new Usage(`${arg} needs a value`);
      if (arg === '--into') parsed.into = value;
      else parsed.name = value;
    } else if (spec.bare.includes(arg)) {
      if (arg === '--new') parsed.own = true;
      else if (arg === '--none') parsed.none = true;
      else parsed.json = true;
    } else if (spec.target && parsed.target === undefined && !arg.startsWith('--')) parsed.target = arg;
    else throw new Usage(`${verb} does not take ${arg}`);
  }
  if (parsed.into !== undefined && parsed.own) throw new Usage('add takes --into or --new, not both');
  if (verb === 'link' && (parsed.into === undefined) === (parsed.none === undefined)) throw new Usage('link takes --into <project> or --none');
  return parsed;
}

/** `MACHINE:PATH` when it names no path here, else a local path made absolute against the working directory. */
function targetOf(arg: string | undefined, cwd: string): Target {
  if (arg === undefined) return { local: cwd };
  const aimed = /^([A-Za-z0-9._-]+):(\/.*)$/.exec(arg);
  if (aimed !== null && !existsSync(resolve(cwd, arg))) return { machine: aimed[1]!, path: canonicalPath(aimed[2]!) };
  return { local: resolve(cwd, arg) };
}

// --- the verbs ---------------------------------------------------------------------------------------------------------

async function run(link: MachineLink, parsed: Parsed, deps: MawsDeps): Promise<number> {
  const registry = (await ask(link, 'projects.registry', undefined)) as ProjectsRegistry;
  const nameOf = (id: string) => registry.projects.find((p) => p.id === id)?.name ?? null;
  try {
    if (parsed.verb === 'list') return list(registry, parsed, deps);
    let target = targetOf(parsed.target, deps.cwd);
    // panel scalpel-1#3: a typed name meets the directory's names without regard to case, as org-protocol keys them
    const named = (name: string) => 'machine' in target && machineNameKey(name) === machineNameKey(target.machine);
    if ('machine' in target && registry.enrolled && named(registry.machine.name)) target = { local: target.path };
    const into = parsed.into === undefined ? undefined : resolveInto(parsed.into, registry);
    if ('machine' in target) {
      if (parsed.verb === 'show') throw new Usage('show takes a folder on this machine');
      if (registry.enrolled && registry.contested.some(named)) throw new Refused(contestedMachine(target.machine)); // branch fix 2: not unknown
      const machine = registry.enrolled ? registry.machines.find((m) => named(m.name))?.name : target.machine; // sent as the directory names it
      if (machine === undefined) throw new Refused(`unknown-machine: ${target.machine} is no machine of this org`);
      if (hasParentSegment(target.path)) throw new Refused(notCanonical(target.path)); // that machine's to resolve, past a link
      return await forward(link, { verb: parsed.verb, machine, path: target.path, ...(parsed.verb === 'link' ? { into: into ?? null } : into !== undefined && { into }), ...(parsed.own && { own: true as const }), ...(parsed.name !== undefined && { name: parsed.name }) }, deps);
    }
    const directory = target.local;
    switch (parsed.verb) {
      case 'add': {
        const added = (await act(link, 'session.projects.addFolder', { directory, ...(into !== undefined && { into }), ...(parsed.own && { own: true as const }) })) as CommandOutput<'session.projects.addFolder'>;
        const project = parsed.name === undefined ? added.project : ((await act(link, 'session.projects.update', { id: added.project.id, patch: { name: parsed.name } })) as ProjectRecord);
        return done(deps, addWords({ ...added, project }, { enrolled: registry.enrolled, nameOf }));
      }
      case 'show':
        return await show(link, directory, registry, parsed.json === true, deps);
      case 'remove': {
        const row = await rowAt(link, directory, { gone: true }); // a folder deleted or renamed away is removed by its old path
        await act(link, 'session.projects.remove', { id: row.id });
        return done(deps, removeWords(row.directory));
      }
      case 'link': {
        const row = await rowAt(link, directory);
        const linked = (await act(link, 'session.projects.link', { id: row.id, into: into ?? null })) as CommandOutput<'session.projects.link'>;
        return done(deps, linkWords(linked, { into: into ?? null, nameOf }));
      }
      default:
        throw new Usage(`maws project has no command ${parsed.verb}`);
    }
  } catch (error) {
    if (error instanceof Refused) return failed(deps, error.message);
    throw error;
  }
}

function list(registry: ProjectsRegistry, parsed: Parsed, deps: MawsDeps): number {
  if (parsed.json) return done(deps, JSON.stringify(registry));
  if (!registry.enrolled) return done(deps, 'this machine is not enrolled, so it holds no project of an org');
  return done(deps, registry.projects.map((project) => projectLine(project, registry)).join('\n'));
}

function projectLine(project: ProjectsRegistry['projects'][number], registry: ProjectsRegistry): string {
  return [project.name, project.id, ...locationsOf(project, registry)].join('  ');
}

function locationsOf(project: ProjectsRegistry['projects'][number], registry: ProjectsRegistry): string[] {
  const machineName = (ref: string) => registry.machines.find((m) => m.ref === ref)?.name ?? ref;
  return project.locations.map((l) => `${machineName(l.machine)}:${l.path}${l.state === undefined ? '' : ` ${l.state}`}`);
}

/** `--into`'s project: an id the registry holds, else the one project of that name; a name shared lists them. */
function resolveInto(value: string, registry: ProjectsRegistry): string {
  if (registry.projects.some((p) => p.id === value)) return value;
  const named = registry.projects.filter((p) => p.name === value);
  if (named.length === 1) return named[0]!.id;
  if (named.length > 1) throw new Refused([`${value} names ${named.length} projects; give its id:`, ...named.map((p) => projectLine(p, registry))].join('\n'));
  return value; // an id no record names yet (a folder's own `.smns`'s): the machine judges it (`unknown-project`)
}

const DECIDED: Record<string, (at: string | null) => string> = {
  link: (at) => `a link at ${at}`,
  minted: (at) => `a stored id at ${at}`,
  smns: (at) => `.smns at ${at}`,
  remote: () => "the repository's remote",
};

async function show(link: MachineLink, directory: string, registry: ProjectsRegistry, json: boolean, deps: MawsDeps): Promise<number> {
  const resolved = (await act(link, 'session.projects.resolve', { directory })) as CommandOutput<'session.projects.resolve'>;
  const project = resolved.project === null ? undefined : registry.projects.find((p) => p.id === resolved.project);
  if (json) return done(deps, JSON.stringify({ ...resolved, name: project?.name ?? null, locations: project?.locations ?? [] }));
  if (resolved.project === null || resolved.by === 'machine') return done(deps, `${directory}\nthis machine's own project`);
  const lines = [`${project?.name ?? resolved.label.name}  ${resolved.project}`, `decided by ${DECIDED[resolved.by]!(resolved.at)}`];
  if (project !== undefined) lines.push(...locationsOf(project, registry));
  return done(deps, lines.join('\n'));
}

/**
 * The row at a folder of this machine, as the index holds it (its real path); refused when it is none here. With `gone`,
 * a folder that is not there is looked for by the path as typed (absolute, NFC), the one its row was declared at.
 */
async function rowAt(link: MachineLink, directory: string, options: { gone?: true } = {}): Promise<ProjectRecord> {
  let real: string;
  try {
    real = realpathSync.native(directory).normalize('NFC');
  } catch {
    if (options.gone !== true) throw new Refused(`not-a-directory: ${directory}`);
    real = directory.normalize('NFC');
  }
  const listed = (await ask(link, 'session.projects.list', undefined)) as CommandOutput<'session.projects.list'>;
  const row = (listed.rows ?? listed.projects).find((r) => r.directory === real && r.hidden !== true);
  if (row === undefined) throw new Refused(`not-declared: ${real} is not a project folder on this machine`);
  return row;
}

async function forward(link: MachineLink, input: CommandInput<'projects.forward'>, deps: MawsDeps): Promise<number> {
  const result = (await ask(link, 'projects.forward', input, FORWARD_TIMEOUT_MS)) as ProjectForwardResult;
  if (result.ok) return done(deps, result.text);
  deps.err(`${result.text}\n`);
  return exitOf(result.code);
}

// --- the daemon --------------------------------------------------------------------------------------------------------

/** A read the command needs: its failure is the command's (exit 1, its words). */
async function ask(link: MachineLink, name: string, input: unknown, timeoutMs?: number): Promise<unknown> {
  const answer: HostResponse = await link.request(name, input, timeoutMs);
  if (!answer.ok) throw new Refused(`${name} failed: ${answer.error.message}`);
  return answer.value;
}

/** A project act: a refusal is printed as its code and sentence (Interfaces §G). */
async function act(link: MachineLink, name: string, input: unknown): Promise<unknown> {
  const answer: HostResponse = await link.request(name, input, ACT_TIMEOUT_MS);
  if (!answer.ok) throw new Refused(actRefusal(answer.error).text);
  return answer.value;
}

function done(deps: MawsDeps, text: string): number {
  deps.out(text === '' ? '' : `${text}\n`);
  return EXIT.done;
}

function failed(deps: MawsDeps, why: string): number {
  deps.err(`${why}\n`);
  return EXIT.failed;
}

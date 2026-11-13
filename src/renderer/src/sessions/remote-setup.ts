// "+ Session" on a machine with no checkout of the org project (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-
// lane-b.md, "Remote setup"; Interfaces §U's rows). The machine menu offers every up RL2 machine: one with a checkout as
// before (remote-spawn.ts), one without it to set the project up there, and one whose owners alone could, or that
// predates the setup, greyed with why. The setup is the machine's owners' to make: its folder list and trust read are
// their `list` calls, its registration their `machine-admin` act (Touch ID), so a member who is not an owner learns it
// from the first listing's `owners-only` before any control is offered.
//
// The sheet (RemoteSetupSheet.tsx) asks which folder there holds the project: the paths the project's other checkouts
// use first, then the machine's home, a page at a time. A private folder macOS protects is never read inside until the
// person opens it, since opening one may raise a privacy prompt on that machine. The chosen folder's trust is read there;
// an untrusted one shows that machine's trust card, whose answer travels as the spawn's `trust: 'accepted'` (the machine
// runs the attested bootstrap; MAWS never writes trust). Then the folder is registered, and its project's directory is
// the spawn's checkout.
//
// 2026-11-06 (the owner's ruling: the machine first, the place following it). The machine menu lists every up RL2
// machine, with or without a project chosen: one where the member may start sessions (their rights there, once its
// `caps` said them) to choose, any other greyed with why. A local project chosen first takes that project's checkout
// there when the machine holds one; otherwise the machine's places are the project chip's (`readPlaces`): its own
// projects, "New project" there (this sheet, naming no org project: any folder, git or not, registered as a project of
// its own), and "Don't work in a project" (its home, a machine owner's alone, where its endpoint lists `rl2.spawn-home`).
// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J; design §6, "+ Session"
// offers the project's locations, "the record saves the round trip"): a project the registry holds takes its location on
// the machine from its record, with no read over the link; a location missing or replaced there is no place to start in.
// A project the registry does not hold is read live, as before.
//
// The UX wave, U9 (O-39, A1; M5, "The chooser is a hook"; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md):
// the project chip's menu on a machine (`useRemotePlaces`) opens with the projects this window already knows there, the
// registry's locations on it and the last listing it answered in this run, replaced by the machine's own list when it
// answers. The folder read no longer holds the projects back: "New project" and "Don't work in a project" wait for it
// alone. "Reading <machine>'s projects…" shows only while nothing is known.
import { useEffect, useMemo, useState } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { IpcError } from '@shared/ipc/errors';
import type { MawsBridge, ProjectRecord } from '@shared/ipc/schema';
import type { FolderEntry } from '@shared/ipc/schema/machine';
import { SPAWN_HOME_CAPABILITY } from '@shared/ipc/schema/session';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { TrustState } from '@shared/sessions/trust';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { registryRecords, type OrgProjects, type RegistryProject } from '../stores/registry';
import { SPAWN_WORDS, type SpawnTarget } from './remote-spawn';

/**
 * What the sheet is opened for: a new project's folder on the machine (`key`, the org project of the tab's local project
 * whose other checkouts' paths it suggests, or null), or the trust of a place the machine refused untrusted (`then`: the
 * Send it answers, asked again).
 */
export type SetupRequest =
  | { kind: 'folder'; tab: AppSessionId; machine: MachineRef; name: string; key: string | null; home: string | null; first: FolderPage; suggestions: string[] }
  | { kind: 'trust'; tab: AppSessionId; target: SpawnTarget; then?: () => void };

export interface FolderPage {
  entries: FolderEntry[];
  cursor: string | null;
}

/** A machine the menu names: to start on (its place there, the local project's checkout when it holds one), or not, and why. */
export type MachineChoice = { kind: 'ready'; target: SpawnTarget } | { kind: 'closed'; machine: MachineRef; name: string; words: string };

export const SETUP_WORDS = {
  title: (machine: string) => `New project on ${machine}`,
  privacy: (machine: string) =>
    `Choose the folder on ${machine} for the project, a git repository or not. Private folders macOS protects (Documents, Desktop, Downloads and the like) stay closed unless you open one, and opening one may show a privacy prompt on ${machine}.`,
  suggestions: 'Where the project’s other checkouts are',
  home: 'Home',
  up: 'Up',
  more: 'Show more',
  empty: 'No folders here',
  loading: 'Reading the folders…',
  private: 'private',
  openPrivate: (folder: string, machine: string) => `Open ${folder}? macOS may show a privacy prompt on ${machine}, which someone there has to answer.`,
  open: 'Open it',
  back: 'Back',
  use: 'Use this folder',
  useHint: 'Open the folder that holds the project, then use it',
  checking: (machine: string) => `Reading its trust on ${machine}…`,
  registering: (machine: string) => `Registering it on ${machine}; confirm with Touch ID…`,
  trustTitle: (machine: string) => `Trust this folder on ${machine}?`,
  trust: 'Trust',
  trustAndStart: 'Trust and start',
  close: 'Close',
  // refusals
  notOwner: (machine: string) => `Only ${machine}’s owners can set up a project there; ask one of them, or start it on another machine`,
  homeNotOwner: (machine: string) => `Only ${machine}’s owners can start a chat outside a project there`, // 2026-11-06
  noSpawn: (machine: string) => `You can’t start sessions on ${machine}; ask its owner for the right to`, // 2026-11-06: no `spawn` there
  projectsUnread: (machine: string) => `Couldn’t read ${machine}’s projects; open the menu again`, // 2026-11-06
  reading: (machine: string) => `Reading ${machine}’s projects…`, // 2026-11-06
  notOffered: (machine: string) => `${machine} can’t set up projects from this Mac yet; update MAWS on ${machine}`,
  noFolder: (machine: string) => `That folder isn’t on ${machine} any more; choose it again`,
  outsideHome: (machine: string) => `${machine} sets up only folders in its home folder`,
  symlinkEscape: (machine: string) => `That folder links out of ${machine}’s home folder; choose the folder it points to`,
  protected: 'That folder is inside a private folder; open the private folder first',
  cancelled: 'Not set up: the confirmation was cancelled',
} as const;

const REASONS = ['owners-only', 'not-offered', 'no-folder', 'outside-home', 'symlink-escape', 'protected', 'step-up-cancelled'] as const;
type Reason = (typeof REASONS)[number];
const wordsOf = (reason: Reason, machine: string): string => {
  switch (reason) {
    case 'owners-only':
      return SETUP_WORDS.notOwner(machine);
    case 'not-offered':
      return SETUP_WORDS.notOffered(machine);
    case 'no-folder':
      return SETUP_WORDS.noFolder(machine);
    case 'outside-home':
      return SETUP_WORDS.outsideHome(machine);
    case 'symlink-escape':
      return SETUP_WORDS.symlinkEscape(machine);
    case 'protected':
      return SETUP_WORDS.protected;
    case 'step-up-cancelled':
      return SETUP_WORDS.cancelled;
  }
};
const isReason = (value: unknown): value is Reason => (REASONS as readonly unknown[]).includes(value);

/** A setup read's or act's error in words: the machine's refusal (main's `issues.refusal`, or a listing's forwarded message, whose first word is the reason) named, anything else as main said it. */
export function setupErrorWords(error: Pick<IpcError, 'code' | 'message' | 'issues'>, machine: string): string {
  const refusal = (error.issues as { refusal?: unknown } | undefined)?.refusal;
  if (isReason(refusal)) return wordsOf(refusal, machine);
  const first = /^([a-z-]+):/.exec(error.message)?.[1];
  if (error.code === 'invalid_input' && isReason(first)) return wordsOf(first, machine);
  return error.message;
}

// A path under a person's home on macOS or Linux, from the home (the checkouts other machines report).
const UNDER_A_HOME = /^\/(?:Users|home)\/[^/]+(?=\/|$)/;

/** The other checkouts' paths as the same paths under this machine's home, each once; nothing without the home. */
export function suggestionsFor(known: readonly string[], home: string | null): string[] {
  if (home === null) return [];
  const found = new Set<string>();
  for (const path of known) {
    const rest = UNDER_A_HOME.test(path) ? path.replace(UNDER_A_HOME, '') : null;
    if (rest === null || rest === '' || rest === '/') continue;
    found.add(`${home}${rest}`);
  }
  return [...found];
}

/** Whether this app reaches the machine over RL2 now (the machines the menu asks). */
const rl2Machines = () => [...useMachines.getState().machines.values()].filter((m) => !m.local && m.state === 'up' && (m.carrier === 'direct' || m.carrier === 'relay'));

/**
 * The project a New chat tab is in, for its machine menu: this Mac's project (its record), a registry project with no
 * folder here (the project registry's M11: the tab was opened on one of its locations elsewhere), or none.
 */
export type TabProject = ProjectId | { registry: string } | null;

/** A tab's project from its binding's project (this Mac's) and its unstarted context's registry project. */
export const tabProject = (projectId: ProjectId | null, registry: string | null): TabProject => projectId ?? (registry === null ? null : { registry });

/** The tab's project: its record's label and, where the registry holds it, its registry project (by id, never by label). */
function projectOfTab(of: TabProject): { key: string | null; registered: RegistryProject | undefined } {
  const { projects, registry } = useSessions.getState();
  if (of !== null && typeof of === 'object') return { key: null, registered: registry.projects.find((p) => p.id === of.registry) };
  const record = of === null ? undefined : projects.get(of);
  const id = record?.org?.smnsId;
  return { key: record?.org?.key ?? null, registered: id == null ? undefined : registry.projects.find((p) => p.id === id) };
}

/**
 * The machines the menu offers, in the roster's order: each to start on, with the checkout there of the tab's project
 * when that machine holds one, else no place yet; or, where the member's rights there are known and hold no `spawn`,
 * greyed with why. Unknown rights grey nothing: the machine decides at the Send. A project the registry holds takes each
 * machine's location from the registry, with no read over the link: for this Mac's project, as that project's checkout
 * there (`key`); for a registry project with no folder here, as a place in that project (`key` null, its name and id).
 * Any other local project's checkout is read live (`session.projects.list`), by its org project's label.
 */
export async function readMachines(of: TabProject, client: MawsBridge = ipc): Promise<MachineChoice[]> {
  const { key, registered } = projectOfTab(of);
  return Promise.all(
    rl2Machines().map(async (machine): Promise<MachineChoice> => {
      if (machine.rights !== undefined && !machine.rights.includes('spawn')) return { kind: 'closed', machine: machine.ref, name: machine.name, words: SETUP_WORDS.noSpawn(machine.name) };
      const none: MachineChoice = { kind: 'ready', target: { machine: machine.ref, name: machine.name, checkout: null, key: null } };
      if (registered !== undefined) {
        const location = registered.locations.find((l) => l.machine === machine.ref && l.state === undefined);
        if (location === undefined) return none;
        const place = key === null ? { key: null, label: registered.name, registry: registered.id } : { key };
        return { kind: 'ready', target: { machine: machine.ref, name: machine.name, checkout: location.path, ...place } };
      }
      if (key === null) return none;
      const projects = await client.invoke('session.projects.list', undefined, { machine: machine.ref }).catch(() => null);
      const checkout = projects?.ok === true ? projects.value.projects.find((p) => p.org?.key === key && p.discovered !== true) : undefined;
      return checkout === undefined ? none : { kind: 'ready', target: { machine: machine.ref, name: machine.name, checkout: checkout.directory, key } };
    }),
  );
}

/**
 * The paths the tab's project has on every machine, which a new project's folder there is suggested by: for a project
 * the registry identifies, its locations and the declared records that carry its id (never another project's that shares
 * its label); otherwise the declared records of its org project's label, as before.
 */
export function knownCheckouts(of: TabProject): string[] {
  const { key, registered } = projectOfTab(of);
  const declared = [...useSessions.getState().projects.values()].filter((p) => p.discovered !== true);
  if (registered !== undefined) return [...new Set([...declared.filter((p) => p.org?.smnsId === registered.id).map((p) => p.directory), ...registered.locations.map((l) => l.path)])];
  if (key === null) return [];
  return [...new Set(declared.filter((p) => p.org?.key === key).map((p) => p.directory))];
}

/** What the folder read says the project chip's menu offers on another machine: `newProject` and `noProject` null when offered, else why not. */
export interface FolderPlaces {
  newProject: string | null;
  noProject: string | null;
  home: string | null;
  first: FolderPage | null;
}

/**
 * The machine's home's first page, which only its owners may read, so it says whether "New project" and "Don't work in
 * a project" are theirs; the latter also needs its endpoint to take a chat in its home (`rl2.spawn-home`, from
 * MachineState's `capabilities`).
 */
export async function readFolderPlaces(machine: MachineRef, name: string, client: MawsBridge = ipc): Promise<FolderPlaces> {
  const spawnsHome = useMachines.getState().machines.get(machine)?.capabilities?.includes(SPAWN_HOME_CAPABILITY) === true;
  const first = await listFolders(machine, name, { path: null }, client);
  if (!first.ok) {
    const noProject = !spawnsHome ? SPAWN_WORDS.noHome(name) : first.words === SETUP_WORDS.notOwner(name) ? SETUP_WORDS.homeNotOwner(name) : first.words;
    return { newProject: first.words, noProject, home: null, first: null };
  }
  const home = first.page.entries.length === 0 ? null : first.page.entries[0].path.slice(0, first.page.entries[0].path.lastIndexOf('/')) || null;
  return { newProject: null, noProject: spawnsHome ? null : SPAWN_WORDS.noHome(name), home, first: first.page };
}

/** The project chip's menu on another machine, as it stands. */
export interface RemotePlaces {
  /** The machine's projects: those known at once, then its own list's answer; null while none is known. */
  projects: ProjectRecord[] | null;
  /** "Reading <machine>'s projects…" while nothing is known and the list has not answered; else null. */
  reading: string | null;
  /** Why the machine's list could not be read, once it answered so. */
  error: string | null;
  /** The folder read's answer; null until it answers. */
  folders: FolderPlaces | null;
}

/** Each machine's last project list answered in this run (state of the run, never stored). */
const lastListing = new Map<MachineRef, ProjectRecord[]>();
/** Forgets the lists of this run (tests). */
export const forgetRemotePlaces = (): void => lastListing.clear();

/** The machine's projects known without a read: its last list of this run, then the registry's locations there it lacks. */
function knownPlaces(machine: MachineRef, registry: OrgProjects): ProjectRecord[] {
  const listed = lastListing.get(machine) ?? [];
  const directories = new Set(listed.map((p) => p.directory));
  const located = [...registryRecords(registry, ipc.localMachine).values()].filter((p) => machineOf(p.id) === machine && p.state === undefined && !directories.has(p.directory));
  return [...listed, ...located];
}

/** The project chip's menu on `machine`: its two reads made as it opens, each shown as it answers. */
export function useRemotePlaces(machine: MachineRef, name: string, client: MawsBridge = ipc): RemotePlaces {
  const registry = useSessions((s) => s.registry);
  const known = useMemo(() => knownPlaces(machine, registry), [machine, registry]);
  // each answer keeps the machine it is of, so a menu opened on another machine shows none of the last one's
  const [listed, setListed] = useState<{ of: MachineRef; projects: ProjectRecord[] | null; error: string | null } | null>(null);
  const [read, setRead] = useState<{ of: MachineRef; folders: FolderPlaces } | null>(null);
  useEffect(() => {
    let live = true;
    void client
      .invoke('session.projects.list', undefined, { machine })
      .catch(() => null)
      .then((answered) => {
        const projects = answered?.ok === true ? answered.value.projects.filter((p) => p.hidden !== true) : null;
        if (projects !== null) lastListing.set(machine, projects);
        if (live) setListed({ of: machine, projects, error: projects === null ? SETUP_WORDS.projectsUnread(name) : null });
      });
    void readFolderPlaces(machine, name, client).then((folders) => live && setRead({ of: machine, folders }));
    return () => {
      live = false;
    };
  }, [machine, name, client]);
  const answer = listed?.of === machine ? listed : null;
  const folders = read?.of === machine ? read.folders : null;
  const projects = answer?.projects ?? (known.length > 0 ? known : null);
  return { projects, reading: answer === null && known.length === 0 ? SETUP_WORDS.reading(name) : null, error: answer?.error ?? null, folders };
}

/** One page of the folders at `path` on the machine (null: its home); `open` reads inside a private folder. */
export async function listFolders(
  machine: MachineRef,
  name: string,
  at: { path: string | null; open?: boolean; cursor?: string },
  client: MawsBridge = ipc,
): Promise<{ ok: true; page: FolderPage } | { ok: false; words: string }> {
  const input = { ...(at.path !== null && { path: at.path }), ...(at.open === true && { open: true as const }), ...(at.cursor !== undefined && { cursor: at.cursor }) };
  const result = await client.invoke('machine.folders.list', input, { machine });
  return result.ok ? { ok: true, page: result.value } : { ok: false, words: setupErrorWords(result.error, name) };
}

/** The folder's trust as the machine reads it. */
export async function checkTrust(machine: MachineRef, name: string, directory: string, client: MawsBridge = ipc): Promise<{ ok: true; trust: TrustState } | { ok: false; words: string }> {
  const result = await client.invoke('session.trust.check', { directory }, { machine });
  return result.ok ? { ok: true, trust: result.value } : { ok: false, words: setupErrorWords(result.error, name) };
}

/** Registers the folder as a project there (the owners' act: main steps it up); its project's directory is the checkout, its name the chip's. */
export async function registerFolder(machine: MachineRef, name: string, directory: string, client: MawsBridge = ipc): Promise<{ ok: true; checkout: string; label: string } | { ok: false; words: string }> {
  const result = await client.invoke('session.projects.addFolder', { directory }, { machine });
  return result.ok ? { ok: true, checkout: result.value.project.directory, label: result.value.project.name } : { ok: false, words: setupErrorWords(result.error, name) };
}

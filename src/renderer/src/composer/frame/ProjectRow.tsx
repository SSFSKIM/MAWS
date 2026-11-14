// New chat (2026-10-01, the owner's ruling): an unstarted tab's row inside the frame, above the box, as Codex's
// new-thread composer has it (`ComposerUtilityBar`'s home layout, readable/chatgpt-26.928.40906/renderer/app/
// composer-utility-bar-e3a99627a7ad.js:9341-9356; its row "flex min-w-0 items-center justify-between gap-2 py-1.5" in a
// "px-1" item, app-primary-fc3cefe64ba8.js:43960-44014). At the left the project chip with its status dot and, read-only
// beside it, the checkout's branch (Codex's label, max-w-40, worktree-environment-dropdown-a806956d556a.js:1027-1088); at
// the right the "Worktree" checkbox, its label before the box (composer-utility-bar:8150-8216), hidden with no project,
// outside git and on an existing worktree (composer-utility-bar:8019, 8147). The chip's menu is Codex's project picker
// (app-primary:147519-147702, 154066-154125): "Search projects", the projects most recently active first (the sidebar's
// order) with a check on the chosen one and the folder's name where it differs from the project's, "No projects
// found", then "New project" and "Don't work in a project". Once the session starts the row is gone and the toolbar's
// location chip reads where it runs. W10 (C9): the directories the "+" menu's Add directory… gave this tab are listed
// read-only in the chip's tooltip and at the foot of its menu, as the location popover lists them once started.
// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The machine menu", A5): beside the project chip,
// the machine the chat runs on (MachineMenu.tsx), and under the row the line naming another machine once it is chosen.
// 2026-11-06 (the owner's ruling: the machine first, the place following it): with another machine chosen, the chip's
// menu is that machine's, in the local menu's shape, and the chip names the place chosen there (the local project's
// checkout there keeps the local project's words, as before): its own projects, most recently active first where this app knows their sessions, "New
// project" there (RemoteSetupSheet.tsx's folder sheet: any folder, git or not, registered as a project there) and "Don't
// work in a project" (its home); one it can't offer is greyed with why, in the item. No branch or Worktree box there:
// they are the local project's. This Mac chosen again, the local row is as it was. UX wave U4a M6 (l3-input-07):
// in both menus a name two listed projects share shows the part of the path that tells them apart, in the folder's place,
// and every row's title is its whole path.
import { Command } from 'cmdk';
import { Popover } from 'radix-ui';
import { useMemo, useState } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import { HOME_CHECKOUT } from '@shared/ipc/schema/session';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { openDialog } from '../../sessions/dialogs';
import { useRemoteSpawn, useSpawnTarget, type SpawnTarget } from '../../sessions/remote-spawn';
import { knownCheckouts, suggestionsFor, tabProject, useRemotePlaces } from '../../sessions/remote-setup';
import { projectsByRecency } from '../../sidebar/derive';
import { projectSuffixes } from '../../sidebar/project-labels';
import { selectProjectOrder, useSessions } from '../../stores/sessions';
import type { HookResult } from '../setup-intent';
import type { ProjectRowBinding } from './bindings';
import { CHIP, NOTE, POPOVER } from './chip-style';
import { formatCwd } from './LocationChip';
import { MachineLine, MachineMenu } from './MachineMenu'; // P5 O7 M4

export const CHOOSE_PROJECT = 'Choose a project';
export const NEW_PROJECT = 'New project';
export const NO_PROJECT = "Don't work in a project";
export const NO_PROJECT_LABEL = 'No project'; // the chip's words for a chat in no project (useSetupIntent's, for another machine's home)
export const PLACE_WORDS = {
  choose: (machine: string) => `Select a project on ${machine} to run your chat in`,
  change: (label: string, machine: string) => `${label} on ${machine} · Change the project for this chat`,
} as const;

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// UX wave U4a M6 (l3-input-07; decision 24): what each row draws dimmed beside the name. For a name another listed
// project shares, the part of its path that tells it apart: the sidebar's part of the parent path (`projectSuffixes`)
// when those parts are distinct across every project of that name; where any two of them tie (two folders under one
// parent), every project of that name takes instead the shortest tail of its whole path that no other of the name
// shares at that depth. Otherwise the folder's name where it differs from the project's. Every row's title is its
// whole path.
function rowDetails(projects: readonly ProjectRecord[]): Map<ProjectRecord['id'], string | null> {
  const suffixes = projectSuffixes(projects);
  const parts = (p: ProjectRecord) => p.directory.split('/').filter(Boolean);
  const tail = (p: ProjectRecord, depth: number) => parts(p).slice(-depth).join('/') || '/';
  return new Map(projects.map((p) => {
    const suffix = suffixes.get(p.id) ?? null;
    if (suffix === null) {
      const folder = basename(p.directory);
      return [p.id, folder !== p.name ? folder : null];
    }
    const namesakes = projects.filter((other) => other.name === p.name);
    const parentParts = new Set(namesakes.map((other) => suffixes.get(other.id)));
    if (parentParts.size === namesakes.length) return [p.id, suffix];
    const others = namesakes.filter((other) => other.id !== p.id);
    let depth = 1;
    while (depth < parts(p).length && others.some((other) => tail(other, depth) === tail(p, depth))) depth++;
    return [p.id, tail(p, depth)];
  }));
}

function ProjectName({ project, detail }: { project: ProjectRecord; detail: string | null }) {
  return (
    <>
      <span className="min-w-0 truncate">{project.name}</span>
      {detail !== null && <span className="min-w-0 shrink truncate text-ui-sm text-fg-muted">{detail}</span>}
    </>
  );
}

// Every project the index lists, most recently active first: the sidebar's level-one order (`projectsByRecency`).
export function recentProjects({ records, digests, projects }: { records: ReadonlyMap<AppSessionId, SessionRecord>; digests: ReadonlyMap<AppSessionId, SessionDigest>; projects: readonly ProjectRecord[]; rows?: unknown }): ProjectRecord[] {
  return projectsByRecency(records, digests, projects);
}

// Codex's search over a project: its name, its folder and its path (app-primary:154181-154183).
export function matchesProject(project: ProjectRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || project.name.toLowerCase().includes(q) || project.directory.toLowerCase().includes(q);
}

const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-ui outline-none select-none data-[selected=true]:bg-bg-hover data-[disabled=true]:text-fg-faint';

// An item of the menu's actions, greyed with its reason as a second line when it can't be taken (`why`).
function ActionItem({ value, label, why, disabled, onSelect }: { value: string; label: string; why: string | null; disabled: boolean; onSelect(): void }) {
  return (
    <Command.Item value={value} disabled={disabled || why !== null} onSelect={onSelect} className={why === null ? ITEM : `${ITEM} h-auto flex-col items-start gap-0 py-1`}>
      <span>{label}</span>
      {why !== null && <span className="text-ui-sm whitespace-normal text-fg-muted">{why}</span>}
    </Command.Item>
  );
}

// 2026-11-06: another machine's places, read as the menu opens (sessions/remote-setup.ts' `readPlaces`); a choice is the
// tab's target there (sessions/remote-spawn.ts), "New project" its folder sheet.
function RemoteMenu({ appSessionId, target, projectId, projectKey, disabled, onDone }: { appSessionId: AppSessionId; target: SpawnTarget; projectId: ProjectId | null; projectKey: string | null; disabled: boolean; onDone(): void }) {
  const [query, setQuery] = useState('');
  const { machine, name } = target;
  // the UX wave, U9 (O-39, A1): the projects known there at once, the machine's list as it answers, the folders apart
  const places = useRemotePlaces(machine, name);
  const folders = places.folders;
  const records = useSessions((s) => s.records);
  const digests = useSessions((s) => s.digests);
  const ordered = useMemo(() => recentProjects({ records, digests, projects: places.projects ?? [] }), [records, digests, places.projects]);
  const shown = ordered.filter((p) => matchesProject(p, query));
  const details = useMemo(() => rowDetails(ordered), [ordered]);
  const choose = (place: Pick<SpawnTarget, 'checkout' | 'label'>) => {
    useRemoteSpawn.getState().choose(appSessionId, { machine, name, key: null, ...place });
    onDone();
  };
  const newProject = () => {
    const first = folders?.first;
    if (first == null) return;
    onDone();
    const home = folders?.home ?? null;
    openDialog({ kind: 'remoteSetup', request: { kind: 'folder', tab: appSessionId, machine, name, key: projectKey, home, first, suggestions: suggestionsFor(knownCheckouts(tabProject(projectId, useSessions.getState().unstarted.get(appSessionId)?.registry ?? null)), home) } });
  };
  return (
    <Command label={`Projects on ${name}`} shouldFilter={false} loop>
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Search projects"
        aria-label="Search projects"
        className="h-8 w-full border-b border-border bg-transparent px-2 text-ui text-fg outline-none placeholder:text-fg-faint"
      />
      <Command.List>
        <Command.Group className="max-h-40 overflow-y-auto py-1">
          {places.reading !== null && <p className="m-0 px-2 py-1.5 text-ui-sm text-fg-muted">{places.reading}</p>}
          {places.error !== null && <p className="m-0 px-2 py-1.5 text-ui-sm text-fg-muted">{places.error}</p>}
          {places.projects !== null && shown.length === 0 && <p className="m-0 px-2 py-1.5 text-ui-sm text-fg-muted">No projects found</p>}
          {shown.map((project) => {
            const chosen = project.directory === target.checkout;
            return (
              <Command.Item key={project.id} value={`project:${project.id}`} disabled={disabled} onSelect={() => choose({ checkout: project.directory, label: project.name })} title={formatCwd(project.directory)} aria-current={chosen || undefined} className={ITEM}>
                <ProjectName project={project} detail={details.get(project.id) ?? null} />
                <span aria-hidden className="ml-auto w-3 shrink-0 text-accent">
                  {chosen ? '✓' : ''}
                </span>
              </Command.Item>
            );
          })}
        </Command.Group>
        <Command.Separator alwaysRender className="border-t border-border" />
        <Command.Group className="py-1">
          <ActionItem value="new-project" label={NEW_PROJECT} why={folders?.newProject ?? null} disabled={disabled || folders?.first == null} onSelect={newProject} />
          {target.checkout !== HOME_CHECKOUT && (
            <ActionItem value="no-project" label={NO_PROJECT} why={folders?.noProject ?? null} disabled={disabled || folders === null} onSelect={() => choose({ checkout: HOME_CHECKOUT, label: NO_PROJECT_LABEL })} />
          )}
        </Command.Group>
      </Command.List>
    </Command>
  );
}

function ProjectMenu({ binding, disabled, onWrite }: { binding: ProjectRowBinding; disabled: boolean; onWrite(write: () => Promise<HookResult>): void }) {
  const [query, setQuery] = useState('');
  const records = useSessions((s) => s.records);
  const digests = useSessions((s) => s.digests);
  // P5 O6 M5: this machine's projects; a session starts on another machine from O7's picker
  const all = useSessions(selectProjectOrder);
  const projects = useMemo(() => all.filter((p) => machineOf(p.id) === ipc.localMachine), [all]);
  const ordered = useMemo(() => recentProjects({ records, digests, projects, rows: [] }), [records, digests, projects]);
  const shown = ordered.filter((p) => matchesProject(p, query));
  const details = useMemo(() => rowDetails(ordered), [ordered]);
  const noProject = binding.projectId === null && binding.label !== null;
  return (
    <Command label="Projects" shouldFilter={false} loop>
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Search projects"
        aria-label="Search projects"
        className="h-8 w-full border-b border-border bg-transparent px-2 text-ui text-fg outline-none placeholder:text-fg-faint"
      />
      <Command.List>
        {/* about five project rows show before they scroll (Codex, app-primary:147583); actions stay visible */}
        <Command.Group className="max-h-40 overflow-y-auto py-1">
          {/* the footer's items are cmdk items too, so its own Empty never shows: the list says it */}
          {shown.length === 0 && <p className="m-0 px-2 py-1.5 text-ui-sm text-fg-muted">No projects found</p>}
          {shown.map((project) => {
            const chosen = project.id === binding.projectId;
            return (
              <Command.Item
                key={project.id}
                value={`project:${project.id}`}
                disabled={disabled}
                onSelect={() => onWrite(() => binding.choose(project.id))}
                title={formatCwd(project.directory)}
                aria-current={chosen || undefined}
                className={ITEM}
              >
                <ProjectName project={project} detail={details.get(project.id) ?? null} />
                <span aria-hidden className="ml-auto w-3 shrink-0 text-accent">
                  {chosen ? '✓' : ''}
                </span>
              </Command.Item>
            );
          })}
        </Command.Group>
        <Command.Separator alwaysRender className="border-t border-border" />
        <Command.Group className="py-1">
          <Command.Item value="new-project" disabled={disabled} onSelect={() => onWrite(binding.newProject)} className={ITEM}>
            {NEW_PROJECT}
          </Command.Item>
          {!noProject && (
            <Command.Item value="no-project" disabled={disabled} onSelect={() => onWrite(() => binding.choose(null))} className={ITEM}>
              {NO_PROJECT}
            </Command.Item>
          )}
        </Command.Group>
      </Command.List>
    </Command>
  );
}

// The tab's additional directories, read-only (W10): what the session will be given besides its project.
export const ADDITIONAL_DIRECTORIES = 'Additional directories';
function DirectoriesNote({ directories }: { directories: readonly string[] }) {
  return (
    <div className="border-t border-border py-1">
      <p className={`${NOTE} m-0`}>{ADDITIONAL_DIRECTORIES}</p>
      <ul aria-label={ADDITIONAL_DIRECTORIES} className="m-0 flex list-none flex-col p-0">
        {directories.map((d) => (
          <li key={d} title={d} className="truncate px-2 py-0.5 font-mono text-ui-sm text-fg-muted">
            {formatCwd(d)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProjectRow({ binding, directories = [], appSessionId }: { binding: ProjectRowBinding; directories?: readonly string[]; appSessionId?: AppSessionId }) {
  const [open, setOpen] = useState(false);
  // P5 O7 M4: the org project the chosen project is, which another machine's checkout must be of
  const projectKey = useSessions((s) => (binding.projectId === null ? null : (s.projects.get(binding.projectId)?.org?.key ?? null)));
  // 2026-11-06: another machine chosen, the menu is its places; a place of its own there (not the local project's checkout
  // there, which keeps the local project's words, branch and Worktree box as before) names the chip
  const remote = useSpawnTarget(appSessionId, projectKey);
  const there = remote !== null && remote.key === null ? remote : null;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const label = there === null ? binding.label : there.checkout === null ? null : (there.label ?? basename(there.checkout));
  const chosen = label !== null;
  const disabled = binding.disabled !== null || pending;
  // All row writes share this lock: a worktree location must use the settled project's repository facts.
  const run = async (write: () => Promise<HookResult>) => {
    if (disabled) return;
    setPending(true);
    try {
      const result = await write();
      setError(result.ok ? null : result.error);
      if (result.ok) setOpen(false);
    } finally {
      setPending(false);
    }
  };
  const base =
    binding.disabled ??
    (there !== null ? (label === null ? PLACE_WORDS.choose(there.name) : PLACE_WORDS.change(label, there.name))
    : chosen ? `${binding.path ?? binding.label} · Change the project for this chat`
    : 'Select a project to run your chat in');
  const title = directories.length > 0 && remote === null ? `${base}\n\n${ADDITIONAL_DIRECTORIES}\n${directories.map(formatCwd).join('\n')}` : base;
  return (
    <div data-project-row className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center justify-between gap-2 px-1 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger aria-label={chosen ? `Project ${label}` : CHOOSE_PROJECT} title={title} className={`${CHIP} ${chosen ? 'text-fg' : ''}`}>
              {/* the status dot: ready to run where the chip says, or waiting for a project (Codex's size-2 badge, app-initial:453119-453146) */}
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${chosen ? 'bg-success' : 'bg-fg-faint'}`} />
              <span className="truncate">{chosen ? label : CHOOSE_PROJECT}</span>
              <span aria-hidden className="shrink-0 text-fg-faint">⌄</span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content aria-label="Choose a project" side="top" align="start" sideOffset={6} collisionPadding={8} className={`${POPOVER} w-72 p-0`}>
                {remote !== null && appSessionId !== undefined ? (
                  <RemoteMenu appSessionId={appSessionId} target={remote} projectId={binding.projectId} projectKey={projectKey} disabled={disabled} onDone={() => setOpen(false)} />
                ) : (
                  <ProjectMenu binding={binding} disabled={disabled} onWrite={(write) => void run(write)} />
                )}
                {directories.length > 0 && remote === null && <DirectoriesNote directories={directories} />}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {appSessionId !== undefined && <MachineMenu appSessionId={appSessionId} projectId={binding.projectId} projectKey={projectKey} disabled={binding.disabled} />}
          {binding.branch !== null && there === null && (
            <span aria-label={`Branch ${binding.branch}`} title={binding.branch} className="max-w-40 truncate font-mono text-ui-sm text-fg-muted">
              ⎇ {binding.branch}
            </span>
          )}
        </div>
        {binding.worktree !== null && there === null && (
          <label title={binding.disabled ?? 'Run this chat in a new git worktree'} className="relative flex shrink-0 items-center gap-2 pe-2 text-ui-sm text-fg-muted select-none">
            Worktree
            <input
              type="checkbox"
              checked={binding.worktree}
              disabled={disabled}
              onChange={(event) => void run(() => binding.setWorktree(event.target.checked))}
              className="size-3.5 accent-accent"
            />
          </label>
        )}
      </div>
      {appSessionId !== undefined && <MachineLine appSessionId={appSessionId} projectKey={projectKey} />}
      {error !== null && (
        <p role="alert" className="m-0 px-2 pb-1 text-ui-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

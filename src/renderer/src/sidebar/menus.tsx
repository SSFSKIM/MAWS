// The sidebar's context menus (§5.1 session and project actions), one Radix ContextMenu for the whole sidebar whose
// items follow the row under the pointer (or the focused row, for the keyboard's context-menu key). Actions another
// child answers render disabled until its handler registers. A foreign-live session offers only the opens (D-12); I2:
// Open replaces the focused pane's session, Open in new tab keeps it. P5 O8 M5: a project's and a machine's row both
// carry the row's People toggle where the row offers it (its `data-people`: others to show, or the toggle on), checked
// while it draws other people's sessions. P5 O8 M7a (Q5): an org project's row whose sminos id the index knows offers
// Channel, the project's one channel tab. P5 O8 M6b: a session's menu offers Share for a session you own, a listed row's
// with no record here included. P5 O8 M5b: Add owner… after Share, for the
// session's owners (sessions/share/target.ts' `useCanAddOwner`). UX wave U7 (O-38, #559): a listed row's menu opens with
// Open and Open in new tab, through its lane's opener. The project registry (docs/doperpowers/plans/
// 2026-11-10-project-registry.md, Interfaces §J): a registry project's row offers Add location… (Add project with the
// project filled) and, unless a `.smns` names it, Rename…; Channel for a hub project only; and a row of a project you see
// only through its sessions (`registry:<id>`) offers Channel alone.
import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { runSessionAction, SESSION_ACTIONS, sessionActionsFor, useSessionActionEnabled, type SessionActionId } from '../app/session-actions';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { openDialog } from '../sessions/dialogs';
import { idKey, machineKey } from '@shared/machine/org-key';
import { selectOrgIndex, sessionsOfRow, type RowKey } from '../stores/org-projects';
import { useLayout } from '../stores/layout'; // P5 O8 M7a
import { CHANNEL } from '../channel/copy'; // P5 O8 M7a
import { useLaneAState } from '../stores/lane-a'; // P5 O9 M5
import { usePeople } from '../stores/people'; // P5 O8 M5
import { useSessions, type ListedSession } from '../stores/sessions';
import { openListed, remoteOpenerFor } from '../sessions/remote-openers'; // UX wave U7
import { useMachines } from '../stores/machines'; // the project registry
import { locationAddress, type OrgProjectLocation } from '../stores/registry'; // the project registry
import { REGISTRY } from './registry-copy'; // the project registry
import { newChatElsewhere, registrySpawnTarget } from './registry-new-chat'; // the project registry
import { PROJECT_ACTION_IDS, PROJECT_ACTIONS, runProjectAction, useProjectActionEnabled, type ProjectActionId } from './project-actions';
import { openResumeChooser } from '../resume/host'; // P2-D
import { KEEP_RUNNING } from './copy'; // P5 O2 M2
import { isRemoteLaneB } from '../lane-b/remote-session'; // P5 O7 M2
import { setRemoteReading } from '../lane-b/remote-reading'; // P5 O8 M6a
import { useReaderRowsOf } from '../lane-b/reader-rows'; // P5 O8 M6a
import { openAddOwner, openShare, useCanAddOwner, useCanShare } from '../sessions/share/target'; // P5 O8 M6b, M5b
import { OWNER, SHARE } from '../sessions/share/copy'; // P5 O8 M6b, M5b

// P5 O8 M5: a project's or machine's `people` says whether its row offers the People toggle.
export type MenuTarget =
  | { kind: 'machine'; machine: MachineRef; people: boolean }
  | { kind: 'session'; appSessionId: AppSessionId }
  | { kind: 'project'; projectId: ProjectId; people: boolean }
  | { kind: 'registry'; id: string; people: boolean }; // the project registry: a row with no location to act on

// The target a `data-menu` attribute names: `session:<appSessionId>`, `project:<projectId>` (an org project's row, by the
// checkout its actions act on) or `machine:<ref>` (a machine's own row, P5 O6 M5).
export function menuTargetOf(element: Element | null): MenuTarget | null {
  const row = element?.closest('[data-menu]') ?? null;
  const value = row?.getAttribute('data-menu') ?? null;
  const people = row?.hasAttribute('data-people') ?? false;
  if (value?.startsWith('machine:')) return { kind: 'machine', machine: value.slice('machine:'.length) as MachineRef, people };
  if (value?.startsWith('session:')) return { kind: 'session', appSessionId: value.slice('session:'.length) as AppSessionId };
  if (value?.startsWith('project:')) return { kind: 'project', projectId: value.slice('project:'.length) as ProjectId, people };
  if (value?.startsWith('registry:')) return { kind: 'registry', id: value.slice('registry:'.length), people };
  return null;
}

const ITEM =
  'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

function Item({ enabled, onSelect, children, dropdown = false }: { dropdown?: boolean; enabled: boolean; onSelect(): void; children: ReactNode }) {
  const Component = dropdown ? DropdownMenu.Item : ContextMenu.Item;
  return (
    <Component disabled={!enabled} onSelect={onSelect} title={enabled ? undefined : 'Not available here'} className={ITEM}>
      {children}
    </Component>
  );
}

export function SidebarMenuContent({ target }: { target: MenuTarget | null }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
        {target?.kind === 'machine' && (
          <>
            <Item enabled onSelect={() => openDialog({ kind: 'archived', projectId: null, machine: target.machine })}>
              Archived sessions…
            </Item>
            {target.people && <PeopleItem rowKey={machineKey(target.machine)} />}
          </>
        )}
        {target?.kind === 'session' && <SessionItems appSessionId={target.appSessionId} />}
        {target?.kind === 'project' && <ProjectItems projectId={target.projectId} people={target.people} />}
        {target?.kind === 'registry' && <RegistryItems id={target.id} people={target.people} />}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

// P5 O8 M6b: the listing-capable session menu. A record's actions, then Share for a session you own (sessions/share/
// target.ts); another machine's listed session with no record here offers its two opens (UX wave U7), then Share.
function SessionItems({ appSessionId, dropdown = false }: { appSessionId: AppSessionId; dropdown?: boolean }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const bridged = useLaneAState(appSessionId)?.bridge === 'live'; // P5 O9 M5
  const kept = useSessions((s) => s.engine.get(appSessionId)?.kept); // P5 O2 M2: undefined while no status reports it
  const remoteReading = useReaderRowsOf(appSessionId) !== 'refused'; // P5 O8 M6a
  const shareable = useCanShare(appSessionId); // P5 O8 M6b
  const ownable = useCanAddOwner(appSessionId); // P5 O8 M5b
  const listed = useSessions((s) => (record === undefined ? s.listed.get(appSessionId) : undefined)); // UX wave U7
  const reach = (
    <>
      {shareable && <ShareItem appSessionId={appSessionId} dropdown={dropdown} />}
      {ownable && <AddOwnerItem appSessionId={appSessionId} dropdown={dropdown} />}
    </>
  );
  if (!record && listed !== undefined) return <><ListedOpenItems listed={listed} dropdown={dropdown} />{reach}</>;
  if (!record) return shareable ? reach : null;
  const foreign = record.holder.kind === 'terminal' || record.holder.kind === 'background_job'; // D-12: the opens only
  return (
    <>
      {sessionActionsFor(record, { bridged, remote: isRemoteLaneB(appSessionId) /* P5 O7 M2 */, remoteReading }).map((id) => <SessionItem key={id} id={id} record={record} dropdown={dropdown} />)}
      {kept !== undefined && !foreign && <KeepItem appSessionId={appSessionId} kept={kept} dropdown={dropdown} />}
      {reach}
    </>
  );
}

// UX wave U7 (O-38, #559): a listing's two opens, each through its lane's opener, never the session actions' handlers,
// whose layout-store `openSession` skips the opener and its retry; drawn disabled where its lane has registered none.
function ListedOpenItems({ listed, dropdown }: { listed: ListedSession; dropdown: boolean }) {
  const enabled = remoteOpenerFor(listed.lane) !== null;
  return (
    <>
      <Item dropdown={dropdown} enabled={enabled} onSelect={() => openListed(listed.appId)}>
        {SESSION_ACTIONS.open}
      </Item>
      <Item dropdown={dropdown} enabled={enabled} onSelect={() => openListed(listed.appId, { newTab: true })}>
        {SESSION_ACTIONS.openInNewTab}
      </Item>
    </>
  );
}

// P5 O8 M6b: the session's Share sheet
export function ShareItem({ appSessionId, dropdown }: { appSessionId: AppSessionId; dropdown?: boolean }) {
  return (
    <Item dropdown={dropdown} enabled onSelect={() => openShare(appSessionId)}>
      {SHARE.menuItem}
    </Item>
  );
}

// P5 O8 M5b: the session's Add owner sheet
function AddOwnerItem({ appSessionId, dropdown }: { appSessionId: AppSessionId; dropdown?: boolean }) {
  return (
    <Item dropdown={dropdown} enabled onSelect={() => openAddOwner(appSessionId)}>
      {OWNER.menuItem}
    </Item>
  );
}

// P5 O2 M2: the owner's Keep running mark (`session.setKeep`), offered beside a session MAWS may act on
function KeepItem({ appSessionId, kept, dropdown }: { appSessionId: AppSessionId; kept: boolean; dropdown?: boolean }) {
  const toggle = async () => {
    const result = await ipc.invoke('session.setKeep', { appSessionId, keep: !kept });
    if (!result.ok) console.error('[sidebar] session.setKeep failed', result.error);
  };
  return (
    <Item dropdown={dropdown} enabled onSelect={() => void toggle()}>
      {kept ? KEEP_RUNNING.stopKeeping : KEEP_RUNNING.keep}
    </Item>
  );
}

function SessionItem({ id, record, dropdown }: { id: SessionActionId; record: SessionRecord; dropdown?: boolean }) {
  const enabled = useSessionActionEnabled(id);
  const label = id === 'pin' && record.pinned ? 'Unpin' : SESSION_ACTIONS[id];
  return (
    <Item dropdown={dropdown} enabled={enabled} onSelect={() => runSessionAction(id, record.appId)}>
      {label}
    </Item>
  );
}

// The project's row in the tree, which a chooser opened from its menu returns the keyboard to.
const projectRowOf = (projectId: ProjectId): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[role="treeitem"][data-menu]')].find((el) => el.dataset.menu === `project:${projectId}`) ?? null;

function ProjectItems({ projectId, people }: { projectId: ProjectId; people: boolean }) {
  const creator = useSessionCreatorRegistered();
  const here = machineOf(projectId) === ipc.localMachine;
  const records = useSessions((s) => s.records);
  const projects = useSessions((s) => s.projects);
  const registry = useSessions((s) => s.registry);
  const project = projects.get(projectId);
  const index = useSessions((s) => selectOrgIndex(s, ipc.localMachine));
  const rowKey = project === undefined ? null : index.keyOf(project);
  // the row's sessions, from every machine
  const unread = rowKey === null ? [] : sessionsOfRow({ records, projects, registry }, ipc.localMachine, rowKey).filter((r) => r.unread && !r.archived);
  // P5 O8 M7a: the org project's sminos id, which keys its channel at the hub; the project registry: a hub project's only
  const org = rowKey === null ? undefined : index.orgs.get(rowKey);
  const smnsId = org?.registry?.hub === false ? null : (org?.smnsId ?? null);
  const registered = org?.registry;
  const machines = useMachines((s) => s.machines);
  const renameAt = registered === undefined || !registered.renamable ? null : renameTarget(registered.locations, machines);
  // a New chat on another machine is O7's picker; the project registry: a project with no folder here starts on one of its
  // locations elsewhere, the machine already chosen (registry-new-chat.ts)
  const elsewhere = here || registered === undefined ? null : registrySpawnTarget(registered, machines);
  const canCreate = creator && (here || elsewhere !== null);
  return (
    <>
      <Item enabled={canCreate} onSelect={() => void (elsewhere !== null ? newChatElsewhere(elsewhere) : createSession(projectId))}>
        New chat
      </Item>
      {/* W11 (I7): the project's Resume… picker, as the row's search icon opens it */}
      <Item enabled onSelect={() => openResumeChooser(projectId, projectRowOf(projectId))}>
        Resume…
      </Item>
      <Item enabled={unread.length > 0} onSelect={() => void markAllRead(unread)}>
        Mark all read
      </Item>
      {people && rowKey !== null && <PeopleItem rowKey={rowKey} />}
      {smnsId !== null && (
        <Item enabled onSelect={() => useLayout.getState().openTab({ kind: 'channel', project: smnsId })}>
          {CHANNEL.menuItem}
        </Item>
      )}
      {registered !== undefined && registered.hub && (
        <Item enabled onSelect={() => openDialog({ kind: 'addProject', into: registered.id })}>
          {REGISTRY.addLocation}
        </Item>
      )}
      {registered !== undefined && renameAt !== null && (
        <Item enabled onSelect={() => openDialog({ kind: 'renameProject', address: renameAt, name: registered.name })}>
          {REGISTRY.rename}
        </Item>
      )}
      <ContextMenu.Separator className="my-1 h-px bg-border" />
      {PROJECT_ACTION_IDS.map((id) => (
        <ProjectItem key={id} id={id} projectId={projectId} />
      ))}
    </>
  );
}

// The project registry: a row of a project you see only through its sessions (no location to act on): its People toggle
// where it has others' sessions (as any project row's), and its Channel.
function RegistryItems({ id, people }: { id: string; people: boolean }) {
  const hub = useSessions((s) => s.registry.projects.find((p) => p.id === id)?.hub ?? false);
  const rowKey = useSessions((s) => s.registry.keys[id] ?? idKey(id)); // its row's key, as orgIndex gives it
  return (
    <>
      {people && <PeopleItem rowKey={rowKey} />}
      {hub && (
        <Item enabled onSelect={() => useLayout.getState().openTab({ kind: 'channel', project: id })}>
          {CHANNEL.menuItem}
        </Item>
      )}
    </>
  );
}

// The location a rename is sent to (§J.3): this Mac's when the project has one, else the first in order whose machine is
// up; only one you may act on. Null: none now.
function renameTarget(locations: readonly OrgProjectLocation[], machines: ReadonlyMap<MachineRef, { state: string }>): ProjectId | null {
  const acting = locations.filter((l) => l.acts);
  const chosen = acting.find((l) => l.machine === ipc.localMachine) ?? acting.find((l) => machines.get(l.machine)?.state === 'up');
  return chosen === undefined ? null : locationAddress(chosen);
}

// P5 O8 M5: the row's People toggle (its hover action's twin), checked while the row draws other people's sessions.
function PeopleItem({ rowKey }: { rowKey: RowKey }) {
  const on = usePeople((s) => s.on.has(rowKey));
  return (
    <ContextMenu.CheckboxItem checked={on} onCheckedChange={() => usePeople.getState().toggle(rowKey)} className={ITEM}>
      Show people’s sessions
      <ContextMenu.ItemIndicator className="ml-auto pl-3 text-accent">✓</ContextMenu.ItemIndicator>
    </ContextMenu.CheckboxItem>
  );
}

function ProjectItem({ id, projectId }: { id: ProjectActionId; projectId: ProjectId }) {
  const enabled = useProjectActionEnabled(id);
  return (
    <Item enabled={enabled} onSelect={() => runProjectAction(id, projectId)}>
      {PROJECT_ACTIONS[id]}
    </Item>
  );
}

// "Mark all read" (residue *Unread*): C4's `session.update` per unread session, with `lastSeen` now.
// P5 O7 M2: a lane B session on another machine is marked read in this app's memory (lane-b/read-marks.ts); P5 O8 M6a: and
// on a machine that keeps each member's own reading, there (lane-b/remote-reading.ts).
async function markAllRead(records: SessionRecord[]): Promise<void> {
  const at = new Date().toISOString();
  const [remote, local] = [records.filter((r) => isRemoteLaneB(r.appId)), records.filter((r) => !isRemoteLaneB(r.appId))];
  await Promise.all([
    ...remote.map(async (r) => {
      const words = await setRemoteReading(r.appId, { unread: false, lastSeen: { messageUuid: r.lastSeen.messageUuid, at } });
      if (words !== null) console.error('[sidebar] session.reader.update (mark read) failed', words);
    }),
    ...local.map(async (r) => {
      const result = await ipc.invoke('session.update', { appSessionId: r.appId, patch: { unread: false, lastSeen: { messageUuid: r.lastSeen.messageUuid, at } } });
      if (!result.ok) console.error('[sidebar] session.update (mark read) failed', result.error);
    }),
  ]);
}

// The same action list as the context menu, without sacrificing title width at rest.
export function SessionOverflow({ appSessionId, title }: { appSessionId: AppSessionId; title: string }) {
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>
      <button type="button" tabIndex={-1} aria-label={`Actions for ${title}`} onClick={(e) => e.stopPropagation()}
        className="hidden size-[22px] shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent group-hover/session:inline-flex group-focus-within/session:inline-flex hover:bg-bg-active focus-visible:outline-2 data-[state=open]:inline-flex">
        <svg viewBox="0 0 16 16" aria-hidden className="size-[13px] fill-current"><circle cx="3" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="13" cy="8" r="1" /></svg>
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={4} onClick={(e) => e.stopPropagation()}
      className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
      <SessionItems appSessionId={appSessionId} dropdown />
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

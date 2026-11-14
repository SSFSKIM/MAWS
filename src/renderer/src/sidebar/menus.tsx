// The sidebar's context menus (§5.1 session and project actions), one Radix ContextMenu for the whole sidebar whose
// items follow the row under the pointer (or the focused row, for the keyboard's context-menu key). Actions another
// child answers render disabled until its handler registers. A foreign-live session offers only the opens (D-12); I2:
// Open replaces the focused pane's session, Open in new tab keeps it. P5 O8 M5: a project's and a machine's row both
// carry the row's People toggle where the row offers it (its `data-people`: others to show, or the toggle on), checked
// while it draws other people's sessions. P5 O8 M7a (Q5): an org project's row whose sminos id the index knows offers
// Channel, the project's one channel tab. P5 O8 M6b: a session's menu offers Share for a session you own, a listed row's
// with no record here included. P5 O8 M5b: Add owner… after Share, for the
// session's owners (sessions/share/target.ts' `useCanAddOwner`). UX wave U7 (O-38, ticket 559): a listed row's menu opens with
// Open and Open in new tab, through its lane's opener. UX wave U7 (O-16): Hide, or Unhide for a hidden session, in every
// tree row's session menu, where `withHide` places it among a record's actions, and directly after a listing's opens; a Needs you
// row's menu has none (the architect's ruling of 2026-11-13: that row stays where it is whatever is hidden). The project registry (docs/doperpowers/plans/
// 2026-11-10-project-registry.md, Interfaces §J): a registry project's row offers Add location… (Add project with the
// project filled) and, unless a `.smns` names it, Rename…; Channel for a hub project only; and a row of a project you see
// only through its sessions (`registry:<id>`) offers Channel alone. The UX wave, U9 (Interfaces §6): a session on another
// machine offers its acts over the link (`remoteSessionActions`), from its listing alone where this Mac holds no record:
// there after the opens and Hide (U7's rule, the architect's ruling of 2026-11-13), before Share and Add owner; an item is
// drawn disabled with the window's helper's sentence as its title.
import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { remoteSessionActions, runSessionAction, SESSION_ACTIONS, sessionActionsFor, useSessionActionEnabled, type SessionActionId } from '../app/session-actions';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { newChat, useSessionCreatorRegistered } from '../keymap/actions-runtime';
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
import { registrySpawnTarget } from './registry-new-chat'; // the project registry
import { PROJECT_ACTION_IDS, PROJECT_ACTIONS, runProjectAction, useProjectActionEnabled, type ProjectActionId } from './project-actions';
import { openResumeChooser } from '../resume/host'; // P2-D
import { HIDDEN, KEEP_RUNNING } from './copy'; // P5 O2 M2; UX wave U7, O-16: HIDDEN
import { isRemoteLaneB } from '../lane-b/remote-session'; // P5 O7 M2
import { setRemoteReading } from '../lane-b/remote-reading'; // P5 O8 M6a
import { useReaderRowsOf } from '../lane-b/reader-rows'; // P5 O8 M6a
import { useSessionActionUnavailable } from '../lane-b/remote-unavailable'; // the UX wave, U9
import { openAddOwner, openShare, useCanAddOwner, useCanShare } from '../sessions/share/target'; // P5 O8 M6b, M5b
import { OWNER, SHARE } from '../sessions/share/copy'; // P5 O8 M6b, M5b
import { useHidden } from '../stores/hidden'; // UX wave U7, O-16
import { useTree } from './tree'; // UX wave U7, O-16

// P5 O8 M5: a project's or machine's `people` says whether its row offers the People toggle.
export type MenuTarget =
  | { kind: 'machine'; machine: MachineRef; people: boolean }
  | { kind: 'session'; appSessionId: AppSessionId; tree: boolean } // UX wave U7, O-16: a row of the tree, which alone offers Hide
  | { kind: 'project'; projectId: ProjectId; people: boolean }
  | { kind: 'registry'; id: string; people: boolean }; // the project registry: a row with no location to act on

// The target a `data-menu` attribute names: `session:<appSessionId>`, `project:<projectId>` (an org project's row, by the
// checkout its actions act on) or `machine:<ref>` (a machine's own row, P5 O6 M5).
export function menuTargetOf(element: Element | null): MenuTarget | null {
  const row = element?.closest('[data-menu]') ?? null;
  const value = row?.getAttribute('data-menu') ?? null;
  const people = row?.hasAttribute('data-people') ?? false;
  if (value?.startsWith('machine:')) return { kind: 'machine', machine: value.slice('machine:'.length) as MachineRef, people };
  if (value?.startsWith('session:')) return { kind: 'session', appSessionId: value.slice('session:'.length) as AppSessionId, tree: row?.closest('[role="tree"]') != null };
  if (value?.startsWith('project:')) return { kind: 'project', projectId: value.slice('project:'.length) as ProjectId, people };
  if (value?.startsWith('registry:')) return { kind: 'registry', id: value.slice('registry:'.length), people };
  return null;
}

const ITEM =
  'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

// `why`: the sentence a disabled item is drawn with, in place of the unregistered words (the UX wave, U9).
function Item({ enabled, onSelect, children, dropdown = false, why = null }: { dropdown?: boolean; enabled: boolean; onSelect(): void; children: ReactNode; why?: string | null }) {
  const Component = dropdown ? DropdownMenu.Item : ContextMenu.Item;
  return (
    <Component disabled={!enabled} onSelect={onSelect} title={enabled ? undefined : (why ?? 'Not available here')} className={ITEM}>
      {children}
    </Component>
  );
}

export function SidebarMenuContent({ target }: { target: MenuTarget | null }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content onCloseAutoFocus={keepMovedFocus} className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
        {target?.kind === 'machine' && (
          <>
            <Item enabled onSelect={() => openDialog({ kind: 'archived', projectId: null, machine: target.machine })}>
              Archived sessions…
            </Item>
            {target.people && <PeopleItem rowKey={machineKey(target.machine)} />}
          </>
        )}
        {target?.kind === 'session' && <SessionItems appSessionId={target.appSessionId} hidable={target.tree} />}
        {target?.kind === 'project' && <ProjectItems projectId={target.projectId} people={target.people} />}
        {target?.kind === 'registry' && <RegistryItems id={target.id} people={target.people} />}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

// P5 O8 M6b: the listing-capable session menu. A record's actions, then Share for a session you own (sessions/share/
// target.ts); another machine's listed session with no record here offers its two opens and Hide (UX wave U7: Hide follows
// the opening items, the architect's ruling of 2026-11-13), then the acts that machine offers for it in
// `remoteSessionActions`' order (the UX wave, U9), then Share and Add owner.
function SessionItems({ appSessionId, dropdown = false, hidable }: { appSessionId: AppSessionId; dropdown?: boolean; hidable: boolean }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const listing = useSessions((s) => s.listed.get(appSessionId)); // the UX wave, U9: `mine`, and a listed row's lane
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
  const mine = listing?.mine ?? false; // the UX wave, U9
  if (!record && listed !== undefined) {
    const acts = remoteSessionActions({ lane: listed.lane, record: false, mine, remoteReading }); // the UX wave, U9
    return (
      <>
        <ListedOpenItems listed={listed} dropdown={dropdown} />
        {hidable && <HideItem appSessionId={appSessionId} dropdown={dropdown} />}
        {acts.map((id) => <SessionItem key={id} id={id} appSessionId={appSessionId} label={SESSION_ACTIONS[id]} dropdown={dropdown} />)}
        {reach}
      </>
    );
  }
  if (!record) return shareable ? reach : null;
  const foreign = record.holder.kind === 'terminal' || record.holder.kind === 'background_job'; // D-12: the opens only
  const actions = sessionActionsFor(record, { bridged, remote: isRemoteLaneB(appSessionId) /* P5 O7 M2 */, remoteReading, mine }); // the UX wave, U9: `mine`
  const items: (SessionActionId | 'hide')[] = hidable ? withHide(actions) : actions;
  return (
    <>
      {items.map((id) => (id === 'hide' ? <HideItem key={id} appSessionId={appSessionId} dropdown={dropdown} /> : <SessionItem key={id} id={id} appSessionId={appSessionId} label={id === 'pin' && record.pinned ? 'Unpin' : SESSION_ACTIONS[id]} dropdown={dropdown} />))}
      {kept !== undefined && !foreign && <KeepItem appSessionId={appSessionId} kept={kept} dropdown={dropdown} />}
      {reach}
    </>
  );
}

// UX wave U7 (O-38, ticket 559): a listing's two opens, each through its lane's opener, never the session actions' handlers,
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

// UX wave U7, O-16 (Interfaces §C): where Hide stands among a record's actions. Both Pin and Hide arrange the list, so
// Hide follows Pin; with no Pin, it follows the opening items, so Archive and the deletes keep the end of the menu.
const OPENING: readonly SessionActionId[] = ['open', 'openInNewTab', 'resume', 'openInSplit', 'attach'];
/** Where Hide stands among a record's actions: directly after `pin`; with no `pin`, after the last of `open`, `openInNewTab`, `resume`, `openInSplit` and `attach`. */
export function withHide(ids: readonly SessionActionId[]): (SessionActionId | 'hide')[] {
  const pin = ids.indexOf('pin');
  const at = pin !== -1 ? pin + 1 : Math.max(-1, ...OPENING.map((id) => ids.lastIndexOf(id))) + 1;
  return [...ids.slice(0, at), 'hide', ...ids.slice(at)];
}

// A Hide or an Unhide moves the keyboard to a row of the sidebar's choosing (its row is gone, or has moved); the menu then
// closes without taking the focus back to its trigger.
let focusMoved = false;
const keepMovedFocus = (event: Event) => {
  if (focusMoved) event.preventDefault();
  focusMoved = false;
};

// UX wave U7, O-16: a tree row's Hide or Unhide, through the sidebar, which places the keyboard after; true when it does.
function useHideAct(appSessionId: AppSessionId): { hidden: boolean; act(): boolean } {
  const hidden = useHidden((s) => s.hidden.has(appSessionId));
  const tree = useTree();
  const act = () => {
    if (tree.onHideAct) return tree.onHideAct(appSessionId, !hidden);
    if (hidden) useHidden.getState().unhide(appSessionId);
    else useHidden.getState().hide(appSessionId);
    return false;
  };
  return { hidden, act };
}

// Hide, or Unhide for a hidden session; an act on this window's view alone, so it never waits for a handler.
function HideItem({ appSessionId, dropdown }: { appSessionId: AppSessionId; dropdown: boolean }) {
  const { hidden, act } = useHideAct(appSessionId);
  return (
    <Item
      dropdown={dropdown}
      enabled
      onSelect={() => {
        focusMoved = act();
      }}
    >
      {hidden ? HIDDEN.unhide : HIDDEN.hide}
    </Item>
  );
}

// UX wave U7, O-16 (M3, decision 9; the owner's answer, "Button on the row"): a tree row's own Hide, or Unhide in the
// Hidden list, left of the three dots while the pointer is over the row or focus is inside it; one click does what the
// menu item does, without opening the session. Out of the tab order, as the row's other controls are: the row is the
// tree's stop, and its menu carries the same act for the keyboard.
export function RowHideButton({ appSessionId }: { appSessionId: AppSessionId }) {
  const { hidden, act } = useHideAct(appSessionId);
  const label = hidden ? HIDDEN.unhide : HIDDEN.hide;
  return (
    <button type="button" tabIndex={-1} aria-label={label} title={label}
      onClick={(event) => {
        event.stopPropagation();
        act();
      }}
      className="hidden size-[22px] shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent group-hover/session:inline-flex group-focus-within/session:inline-flex hover:bg-bg-active hover:text-fg focus-visible:outline-2">
      {hidden ? <EyeIcon /> : <EyeOffIcon />}
    </button>
  );
}

// An eye, and the eye struck through (lucide's `eye` and `eye-off` redrawn on the 16px grid), in the current colour.
const EyeIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="size-[13px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]">
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);
const EyeOffIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="size-[13px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]">
    <path d="M6.6 3.7A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.6 2.1M4.3 4.9A11 11 0 0 0 1.5 8S3.9 12.5 8 12.5c1.3 0 2.4-.4 3.3-1M6.6 6.6a2 2 0 0 0 2.8 2.8M2 2l12 12" />
  </svg>
);

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

// The UX wave, U9: disabled with the window's helper's sentence where the act can't work on the session's machine.
function SessionItem({ id, appSessionId, label, dropdown }: { id: SessionActionId; appSessionId: AppSessionId; label: string; dropdown?: boolean }) {
  const why = useSessionActionUnavailable(id, appSessionId);
  const enabled = useSessionActionEnabled(id) && why === null;
  return (
    <Item dropdown={dropdown} enabled={enabled} why={why} onSelect={() => runSessionAction(id, appSessionId)}>
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
  const listed = useSessions((s) => s.listed); // ticket 644: another machine's record is the row's its listing files it under
  const project = projects.get(projectId);
  const index = useSessions((s) => selectOrgIndex(s, ipc.localMachine));
  const rowKey = project === undefined ? null : index.keyOf(project);
  // the row's sessions, from every machine
  const unread = rowKey === null ? [] : sessionsOfRow({ records, projects, registry, listed }, ipc.localMachine, rowKey).filter((r) => r.unread && !r.archived);
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
      <Item enabled={canCreate} onSelect={() => void newChat({ row: rowKey ?? projectId })}>
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
    <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={4} onClick={(e) => e.stopPropagation()} onCloseAutoFocus={keepMovedFocus}
      className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
      <SessionItems appSessionId={appSessionId} dropdown hidable /* the three dots are a tree row's own */ />
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

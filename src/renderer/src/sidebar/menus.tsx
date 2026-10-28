// The sidebar's context menus (§5.1 session and project actions), one Radix ContextMenu for the whole sidebar whose
// items follow the row under the pointer (or the focused row, for the keyboard's context-menu key). Actions another
// child answers render disabled until its handler registers. A foreign-live session offers only the opens (D-12); I2:
// Open replaces the focused pane's session, Open in new tab keeps it. P5 O8 M5: a project's and a machine's row both
// carry the row's People toggle, checked while it draws other people's sessions.
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
import { machineKey } from '@shared/machine/org-key';
import { orgKeyOf, sessionsOfRow, type RowKey } from '../stores/org-projects';
import { usePeople } from '../stores/people'; // P5 O8 M5
import { useSessions } from '../stores/sessions';
import { PROJECT_ACTION_IDS, PROJECT_ACTIONS, runProjectAction, useProjectActionEnabled, type ProjectActionId } from './project-actions';
import { openResumeChooser } from '../resume/host'; // P2-D
import { KEEP_RUNNING } from './copy'; // P5 O2 M2

export type MenuTarget = { kind: 'machine'; machine: MachineRef } | { kind: 'session'; appSessionId: AppSessionId } | { kind: 'project'; projectId: ProjectId };

// The target a `data-menu` attribute names: `session:<appSessionId>`, `project:<projectId>` (an org project's row, by the
// checkout its actions act on) or `machine:<ref>` (a machine's own row, P5 O6 M5).
export function menuTargetOf(element: Element | null): MenuTarget | null {
  const value = element?.closest('[data-menu]')?.getAttribute('data-menu') ?? null;
  if (value?.startsWith('machine:')) return { kind: 'machine', machine: value.slice('machine:'.length) as MachineRef };
  if (value?.startsWith('session:')) return { kind: 'session', appSessionId: value.slice('session:'.length) as AppSessionId };
  if (value?.startsWith('project:')) return { kind: 'project', projectId: value.slice('project:'.length) as ProjectId };
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
            <PeopleItem rowKey={machineKey(target.machine)} />
          </>
        )}
        {target?.kind === 'session' && <SessionItems appSessionId={target.appSessionId} />}
        {target?.kind === 'project' && <ProjectItems projectId={target.projectId} />}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

function SessionItems({ appSessionId, dropdown = false }: { appSessionId: AppSessionId; dropdown?: boolean }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const kept = useSessions((s) => s.engine.get(appSessionId)?.kept); // P5 O2 M2: undefined while no status reports it
  if (!record) return null;
  const foreign = record.holder.kind === 'terminal' || record.holder.kind === 'background_job'; // D-12: the opens only
  return (
    <>
      {sessionActionsFor(record).map((id) => <SessionItem key={id} id={id} record={record} dropdown={dropdown} />)}
      {kept !== undefined && !foreign && <KeepItem appSessionId={appSessionId} kept={kept} dropdown={dropdown} />}
    </>
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

function ProjectItems({ projectId }: { projectId: ProjectId }) {
  const canCreate = useSessionCreatorRegistered() && machineOf(projectId) === ipc.localMachine; // a New chat on another machine is O7's picker
  const records = useSessions((s) => s.records);
  const projects = useSessions((s) => s.projects);
  const project = projects.get(projectId);
  // the row's sessions, from every machine
  const unread = project === undefined ? [] : sessionsOfRow({ records, projects }, ipc.localMachine, orgKeyOf(project)).filter((r) => r.unread && !r.archived);
  return (
    <>
      <Item enabled={canCreate} onSelect={() => void createSession(projectId)}>
        New chat
      </Item>
      {/* W11 (I7): the project's Resume… picker, as the row's search icon opens it */}
      <Item enabled onSelect={() => openResumeChooser(projectId, projectRowOf(projectId))}>
        Resume…
      </Item>
      <Item enabled={unread.length > 0} onSelect={() => void markAllRead(unread)}>
        Mark all read
      </Item>
      {project !== undefined && <PeopleItem rowKey={orgKeyOf(project)} />}
      <ContextMenu.Separator className="my-1 h-px bg-border" />
      {PROJECT_ACTION_IDS.map((id) => (
        <ProjectItem key={id} id={id} projectId={projectId} />
      ))}
    </>
  );
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
async function markAllRead(records: SessionRecord[]): Promise<void> {
  const at = new Date().toISOString();
  await Promise.all(
    records.map(async (r) => {
      const result = await ipc.invoke('session.update', { appSessionId: r.appId, patch: { unread: false, lastSeen: { messageUuid: r.lastSeen.messageUuid, at } } });
      if (!result.ok) console.error('[sidebar] session.update (mark read) failed', result.error);
    }),
  );
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

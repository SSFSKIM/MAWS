// The sidebar's context menus (§5.1 session and project actions), one Radix ContextMenu for the whole sidebar whose
// items follow the row under the pointer (or the focused row, for the keyboard's context-menu key). Actions another
// child answers render disabled until its handler registers. A foreign-live session offers only the opens (D-12); I2:
// Open replaces the focused pane's session, Open in new tab keeps it.
import { ContextMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { runSessionAction, SESSION_ACTIONS, sessionActionsFor, useSessionActionEnabled, type SessionActionId } from '../app/session-actions';
import { ipc } from '../ipc/client';
import { createSession, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { openDialog } from '../sessions/dialogs';
import { useSessions } from '../stores/sessions';
import { PROJECT_ACTION_IDS, PROJECT_ACTIONS, runProjectAction, useProjectActionEnabled, type ProjectActionId } from './project-actions';
import { openResumePicker } from './ResumePicker';

export type MenuTarget = { kind: 'other' } | { kind: 'session'; appSessionId: AppSessionId } | { kind: 'project'; projectId: ProjectId };

// The target a `data-menu` attribute names: `session:<appSessionId>`, `project:<projectId>` or `other`.
export function menuTargetOf(element: Element | null): MenuTarget | null {
  const value = element?.closest('[data-menu]')?.getAttribute('data-menu') ?? null;
  if (value === 'other') return { kind: 'other' };
  if (value?.startsWith('session:')) return { kind: 'session', appSessionId: value.slice('session:'.length) as AppSessionId };
  if (value?.startsWith('project:')) return { kind: 'project', projectId: value.slice('project:'.length) as ProjectId };
  return null;
}

const ITEM =
  'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

function Item({ enabled, onSelect, children }: { enabled: boolean; onSelect(): void; children: ReactNode }) {
  return (
    <ContextMenu.Item disabled={!enabled} onSelect={onSelect} title={enabled ? undefined : 'Not available here'} className={ITEM}>
      {children}
    </ContextMenu.Item>
  );
}

export function SidebarMenuContent({ target }: { target: MenuTarget | null }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
        {target?.kind === 'other' && (
          <Item enabled onSelect={() => openDialog({ kind: 'archived', projectId: null })}>
            Archived sessions…
          </Item>
        )}
        {target?.kind === 'session' && <SessionItems appSessionId={target.appSessionId} />}
        {target?.kind === 'project' && <ProjectItems projectId={target.projectId} />}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

function SessionItems({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  if (!record) return null;
  return sessionActionsFor(record).map((id) => <SessionItem key={id} id={id} record={record} />);
}

function SessionItem({ id, record }: { id: SessionActionId; record: SessionRecord }) {
  const enabled = useSessionActionEnabled(id);
  const label = id === 'pin' && record.pinned ? 'Unpin' : SESSION_ACTIONS[id];
  return (
    <Item enabled={enabled} onSelect={() => runSessionAction(id, record.appId)}>
      {label}
    </Item>
  );
}

function ProjectItems({ projectId }: { projectId: ProjectId }) {
  const canCreate = useSessionCreatorRegistered();
  const records = useSessions((s) => s.records);
  const unread = [...records.values()].filter((r) => r.projectId === projectId && r.unread && !r.archived);
  return (
    <>
      <Item enabled={canCreate} onSelect={() => void createSession(projectId)}>
        New chat
      </Item>
      {/* W11 (I7): the project's Resume… picker, as the row's search icon opens it */}
      <Item enabled onSelect={() => openResumePicker(projectId)}>
        Resume…
      </Item>
      <Item enabled={unread.length > 0} onSelect={() => void markAllRead(unread)}>
        Mark all read
      </Item>
      <ContextMenu.Separator className="my-1 h-px bg-border" />
      {PROJECT_ACTION_IDS.map((id) => (
        <ProjectItem key={id} id={id} projectId={projectId} />
      ))}
    </>
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

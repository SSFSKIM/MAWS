// The Source control tool's body (E6 execution document, Design §5), top to bottom: the branch line with the Push and
// Open PR actions, the notice, the four groups as collapsible sections with their row and group actions, the selected
// file's diff, the commit form, and the Output disclosure of the latest remote run. The status is C4's through C8a's
// `useGit`, whose watch this body holds while mounted, as it holds the session's latest run (seeded from
// `scm.remote.last`, so a run outlives a reload); the lists move only when the watcher's `git.changed` arrives (main
// refreshes the watcher after every mutation, Design §1). The trust comes from `scm.status`: an untrusted checkout is
// listed and read, and every git action is disabled. A non-repository shows C8a's sentence alone.
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmStatus } from '@shared/ipc/schema/scm';
import { NOT_A_REPOSITORY } from '../../sessions/branch-label';
import { useGit } from '../../stores/git';
import { openFile } from '../code/open-file';
import { CommitForm } from './CommitForm';
import { SCM_COPY } from './copy';
import { DiscardSheet } from './DiscardSheet';
import { FileRow, type RowActions } from './FileRow';
import { checkoutPath, groupsOf, SCM_GROUPS, type ScmEntry, type ScmGroupName, type ScmGroups } from './groups';
import { Notice } from './Notice';
import { Output } from './Output';
import { PrSheet } from './PrSheet';
import { PushSheet } from './PushSheet';
import { RemoteActions } from './RemoteActions';
import { ScmDiff } from './ScmDiff';
import { useScmStatus } from './queries';
import { useScm } from './store';
import { applyRequest, followSelection, selectFile, toggleCollapsed, type ScmUi } from './view-state';

export interface ScmShellProps {
  appSessionId: AppSessionId;
  directory: string; // the checkout: session.worktree?.path ?? session.directory
  ui: StoreApi<ScmUi>;
}

const Message = ({ children, role }: { children: string; role?: 'status' }) => (
  <p role={role} data-scm-message className="px-3 py-2 text-ui text-fg-muted">
    {children}
  </p>
);

export function ScmShell({ appSessionId, directory, ui }: ScmShellProps) {
  useEffect(() => useGit.getState().watch(directory), [directory]);
  useEffect(() => useScm.getState().resume(appSessionId), [appSessionId]);
  const entry = useGit((s) => s.entries.get(directory));
  const status = entry?.status ?? null;
  const gitError = status === null ? (entry?.error ?? null) : null;
  const scm = useScmStatus(appSessionId);
  // Known from `scm.status`, or null while it is read; a failed read is said and gates the actions as untrusted would.
  // Trust is recorded in main by a session's setup (C10's Trust and start, the `trusting` phase), which the renderer
  // learns of only through `session.setup`: every phase re-reads `scm.status` (the app-level listener, E11 W-D), so the
  // untrusted notice clears without a remount. A re-shown tool (the host remounts it) and the window coming back into
  // view (TanStack v5 listens to `visibilitychange`, not to window focus) re-read a stale query too.
  const trusted = scm.data ? scm.data.trusted : scm.isError ? false : null;
  const groups = useMemo(() => groupsOf(status), [status]);

  // An open() waiting is applied once the status is known; a watch that failed consumes it.
  const requested = useStore(ui, (s) => s.request !== null);
  useEffect(() => {
    if (!requested) return;
    if (status !== null) ui.setState((s) => applyRequest(s, status, directory));
    else if (gitError !== null) ui.setState({ request: null });
  }, [requested, status, gitError, directory, ui]);

  // The selection follows its file to the group git lists it in next (Stage moves it to Staged), or goes when git lists
  // it nowhere. Derived here for this very render, so the diff body drops a stale untracked hold in the commit that
  // takes the status, long before the hold's 250 ms re-read would ask main for a file it no longer calls untracked.
  const stored = useStore(ui, (s) => s.selected);
  const followed = useMemo(() => followSelection({ selected: stored }, groups), [stored, groups]);
  const selected = 'selected' in followed ? (followed.selected ?? null) : stored;
  useLayoutEffect(() => {
    if (status !== null && 'selected' in followed) ui.setState(followed);
  }, [status, followed, ui]);

  if (status === null) {
    if (gitError === null) return <Message>{SCM_COPY.loading}</Message>;
    return <Message role="status">{gitError === NOT_A_REPOSITORY ? SCM_COPY.notRepository : SCM_COPY.gitUnavailable(gitError)}</Message>;
  }

  const actions: RowActions = {
    select: (selection) => ui.setState(selectFile(selection)),
    stage: (paths) => void useScm.getState().stage(ui, appSessionId, paths),
    unstage: (paths) => void useScm.getState().unstage(ui, appSessionId, paths),
    discard: (entries) => ui.setState({ sheet: { kind: 'discard', entries } }),
    open: (path) => openFile(appSessionId, checkoutPath(status.repoRoot, path), null),
  };
  const selectedEntry = selected === null ? null : (groups[selected.group].find((candidate) => candidate.path === selected.path) ?? null);
  const empty = SCM_GROUPS.every((name) => groups[name].length === 0);

  return (
    <div data-scm className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <p data-scm-header className="m-0 min-w-0 flex-1 truncate text-ui-sm text-fg">
          {headerOf(status)}
        </p>
        <RemoteActions appSessionId={appSessionId} ui={ui} status={status} directory={directory} scm={{ data: scm.data, error: scm.error?.message }} trusted={trusted} />
      </div>
      {scm.data && !scm.data.trusted ? (
        <p role="status" data-scm-untrusted className="m-0 shrink-0 border-b border-border px-3 py-1.5 text-ui-sm text-warning">
          {SCM_COPY.untrusted}
        </p>
      ) : !scm.data && scm.error ? (
        <p role="status" data-scm-status-failed className="m-0 shrink-0 border-b border-border px-3 py-1.5 text-ui-sm text-danger">
          {SCM_COPY.statusFailed(scm.error.message)}
        </p>
      ) : null}
      <Notice ui={ui} />
      <div data-scm-groups className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border py-1">
        {SCM_GROUPS.map((name) =>
          name === 'conflicts' && groups.conflicts.length === 0 ? null : (
            <GroupSection key={name} name={name} groups={groups} ui={ui} selected={selected} enabled={trusted === true} actions={actions} />
          ),
        )}
      </div>
      {selectedEntry !== null && selected !== null ? (
        <ScmDiff appSessionId={appSessionId} directory={directory} repoRoot={status.repoRoot} ui={ui} group={selected.group} entry={selectedEntry} />
      ) : (
        <div className="min-h-0 flex-1">
          <Message>{empty ? SCM_COPY.noChanges : SCM_COPY.selectFile}</Message>
        </div>
      )}
      <CommitForm appSessionId={appSessionId} ui={ui} groups={groups} trusted={trusted} />
      <Output appSessionId={appSessionId} ui={ui} />
      <Sheets appSessionId={appSessionId} ui={ui} status={status} scm={scm.data} directory={directory} />
    </div>
  );
}

function headerOf(status: GitStatus): string {
  const parts = [status.branch !== null ? SCM_COPY.branch(status.branch) : SCM_COPY.detached(status.head)];
  if (status.branch !== null) {
    if (status.upstream === null) parts.push(SCM_COPY.noUpstream);
    else {
      parts.push(status.upstream, SCM_COPY.ahead(status.ahead));
      if (status.behind > 0) parts.push(SCM_COPY.behind(status.behind));
    }
  }
  return parts.join(' · ');
}

// The group's own actions, as text buttons in its header (M3's decision): Unstage all for Staged; Discard all… and
// Stage all for Unstaged; Delete all… and Stage all for Untracked; none for Conflicts (each is resolved on its own).
function GroupActions({ name, entries, enabled, actions }: { name: ScmGroupName; entries: readonly ScmEntry[]; enabled: boolean; actions: RowActions }) {
  if (entries.length === 0 || name === 'conflicts') return null;
  const paths = entries.map((entry) => entry.path);
  const button = (label: string, text: string, onClick: () => void) => (
    <button type="button" aria-label={label} title={label} data-scm-action disabled={!enabled} onClick={onClick} className="rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-active hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
      {text}
    </button>
  );
  if (name === 'staged') return button(SCM_COPY.unstageAll, SCM_COPY.unstageAll, () => actions.unstage(paths));
  if (name === 'unstaged') {
    return (
      <>
        {button(SCM_COPY.discardAllLabel, SCM_COPY.discardAll, () => actions.discard(paths.map((path) => ({ path, group: 'unstaged' }))))}
        {button(SCM_COPY.stageAllLabel.unstaged, SCM_COPY.stageAll, () => actions.stage(paths))}
      </>
    );
  }
  return (
    <>
      {button(SCM_COPY.deleteAllLabel, SCM_COPY.deleteAll, () => actions.discard(paths.map((path) => ({ path, group: 'untracked' }))))}
      {button(SCM_COPY.stageAllLabel.untracked, SCM_COPY.stageAll, () => actions.stage(paths))}
    </>
  );
}

function GroupSection({ name, groups, ui, selected, enabled, actions }: { name: ScmGroupName; groups: ScmGroups; ui: StoreApi<ScmUi>; selected: { group: ScmGroupName; path: string } | null; enabled: boolean; actions: RowActions }) {
  const collapsed = useStore(ui, (s) => s.collapsed.has(name));
  const entries = groups[name];
  const title = SCM_COPY.groups[name];
  return (
    <section aria-label={title} data-scm-group={name} className="flex flex-col">
      <div className="group flex h-6 items-center gap-1 pr-2 hover:bg-bg-hover">
        <button type="button" aria-expanded={!collapsed} onClick={() => ui.setState((s) => toggleCollapsed(s, name))} className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left text-ui-sm font-medium text-fg-muted hover:text-fg">
          <span aria-hidden="true" className="w-3 text-center">
            {collapsed ? '›' : '⌄'}
          </span>
          <span className={name === 'conflicts' ? 'text-danger' : undefined}>{title}</span>
          <span data-scm-count className="rounded-sm bg-bg-active px-1 text-ui-sm text-fg-muted">
            {entries.length}
          </span>
        </button>
        <GroupActions name={name} entries={entries} enabled={enabled} actions={actions} />
      </div>
      {collapsed || entries.length === 0 ? null : (
        <ul aria-label={title} className="m-0 list-none p-0">
          {entries.map((entry) => (
            <FileRow key={entry.path} group={name} entry={entry} selected={selected?.group === name && selected.path === entry.path} enabled={enabled} actions={actions} />
          ))}
        </ul>
      )}
    </section>
  );
}

// The open sheet of this tool: Discard, Push or Open PR.
function Sheets({ appSessionId, ui, status, scm, directory }: { appSessionId: AppSessionId; ui: StoreApi<ScmUi>; status: GitStatus; scm: ScmStatus | undefined; directory: string }) {
  const sheet = useStore(ui, (s) => s.sheet);
  if (sheet?.kind === 'discard') return <DiscardSheet appSessionId={appSessionId} ui={ui} entries={sheet.entries} />;
  if (sheet?.kind === 'push') return <PushSheet appSessionId={appSessionId} ui={ui} status={status} scm={scm} />;
  if (sheet?.kind === 'pr') return <PrSheet appSessionId={appSessionId} ui={ui} status={status} scm={scm} directory={directory} />;
  return null;
}

// The Worktrees… dialog on the project menu (C12 execution document, Interfaces "Worktrees dialog"; D4, D-20): the
// lasting entry point to every worktree of the project's repository. Laid out as Codex desktop's Settings › Worktrees
// rows (the checkout, its conversations, "New chat in this worktree", Delete; Refresh; the empty and error states),
// in C10's words and with C10's cleanup ladder behind Remove…. Renderer only: git's list and each checkout's status
// (with main's occupancy) are read when the dialog opens, on Refresh, and again when a cleanup it opened closes (the
// cleanup returns here, which mounts this afresh); the setup intents that claim a checkout are C10's live store.
import { useEffect, useState } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { WorktreeInfo, WorktreeStatus } from '@shared/sessions/worktree';
import { ipc } from '../ipc/client';
import { createSession } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { cleanupTargetAt, closeDialog, openDialog } from './dialogs';
import { patchIntent } from './setup-actions';
import { Sheet } from './Sheet';
import { isStarting, useSetup } from './store';
import { QUIET, SECONDARY } from './ui';
import { worktreeRows, type Claim, type WorktreeRow } from './worktree-rows';
import { displayTitle } from './title';

type Loaded =
  | { kind: 'loading' }
  | { kind: 'not_repository' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; repoRoot: string; worktrees: WorktreeInfo[]; statuses: Map<string, WorktreeStatus | null> };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function readWorktrees(directory: string): Promise<Loaded> {
  const listed = await ipc.invoke('git.worktree.list', { repoRoot: directory });
  if (!listed.ok) return listed.error.message === 'not a git repository' ? { kind: 'not_repository' } : { kind: 'error', message: listed.error.message };
  const { repoRoot, worktrees } = listed.value;
  const answers = await Promise.all(worktrees.map((w) => ipc.invoke('git.worktree.status', { repoRoot, path: w.path })));
  const failed = answers.find((a) => !a.ok);
  if (failed && !failed.ok) return { kind: 'error', message: failed.error.message };
  return { kind: 'ready', repoRoot, worktrees, statuses: new Map(worktrees.map((w, i) => [w.path, answers[i]!.ok ? answers[i]!.value : null])) };
}

export function WorktreesDialog({ projectId }: { projectId: ProjectId }) {
  const project = useSessions((s) => s.projects.get(projectId) ?? null);
  const intents = useSetup((s) => s.intents);
  const invoking = useSetup((s) => s.invoking);
  const phases = useSetup((s) => s.phases);
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [version, setVersion] = useState(0); // Refresh

  const directory = project?.directory ?? null;
  useEffect(() => {
    if (directory === null) return;
    let live = true;
    void readWorktrees(directory).then((next) => live && setLoaded(next));
    return () => {
      live = false;
    };
  }, [directory, version]);

  const claims: Claim[] = [...intents.values()].map((intent) => ({ intent, starting: isStarting({ invoking, phases }, intent.appSessionId) }));
  const title = `Worktrees${project ? ` · ${project.name}` : ''}`;
  const refresh = () => {
    setLoaded({ kind: 'loading' });
    setVersion((v) => v + 1);
  };

  return (
    <Sheet title={title} width="w-[min(640px,92vw)]" data-c12="worktrees">
      {loaded.kind === 'loading' ? (
        <p className="m-0 text-fg-muted">Reading worktrees…</p>
      ) : loaded.kind === 'not_repository' ? (
        <p className="m-0 text-fg-muted">Not a git repository</p>
      ) : loaded.kind === 'error' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-fg">Unable to load worktrees</p>
          <p className="m-0 text-ui-sm break-all text-fg-muted">{loaded.message}</p>
          <div>
            <button type="button" onClick={refresh} className={SECONDARY}>
              Refresh
            </button>
          </div>
        </div>
      ) : (
        <Rows projectId={projectId} repoRoot={loaded.repoRoot} rows={worktreeRows(loaded.worktrees, loaded.statuses, claims)} onRefresh={refresh} />
      )}
    </Sheet>
  );
}

function Rows({ projectId, repoRoot, rows, onRefresh }: { projectId: ProjectId; repoRoot: string; rows: WorktreeRow[]; onRefresh(): void }) {
  const linked = rows.filter((r) => !r.isMain).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-ui-sm text-fg-muted">{repoRoot}</span>
        <button type="button" onClick={onRefresh} className={SECONDARY}>
          Refresh
        </button>
      </div>
      <ul aria-label="Worktrees" className="m-0 flex max-h-[60vh] list-none flex-col gap-2 overflow-auto p-0">
        {rows.map((row) => (
          <Row key={row.info.path} projectId={projectId} repoRoot={repoRoot} row={row} />
        ))}
      </ul>
      {linked === 0 && (
        <div className="flex flex-col gap-0.5 px-1 text-ui-sm">
          <span className="text-fg">No worktrees yet</span>
          <span className="text-fg-muted">Worktrees MAWS or Claude Code create in this repository appear here</span>
        </div>
      )}
    </div>
  );
}

function Row({ projectId, repoRoot, row }: { projectId: ProjectId; repoRoot: string; row: WorktreeRow }) {
  const records = useSessions((s) => s.records);
  const [busy, setBusy] = useState(false);
  const titleOf = (id: AppSessionId) => displayTitle(records.get(id));

  const newSessionHere = async () => {
    setBusy(true);
    const appSessionId = await createSession(projectId);
    if (appSessionId !== null) {
      const patched = await patchIntent(appSessionId, { location: { kind: 'existingWorktree', repoRoot, path: row.info.path } });
      if (!patched.ok) toast({ level: 'danger', text: `The new session stays in the project directory: ${patched.error}`, actions: [], dismissible: true });
    }
    setBusy(false);
    closeDialog();
  };
  const remove = () => openDialog({ kind: 'cleanup', target: cleanupTargetAt({ path: row.info.path, branch: row.info.branch }, repoRoot), returnTo: { kind: 'worktrees', projectId } });
  const openSession = (id: AppSessionId) => {
    useLayout.getState().openSession(id);
    closeDialog();
  };

  return (
    <li aria-label={row.name} data-state={row.state} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5 text-ui-sm">
          <span className="text-ui text-fg">
            {row.name}
            <span className="text-fg-muted">{` · ${row.branchLabel === 'detached' ? 'detached' : `⎇ ${row.branchLabel}`}${row.isMain ? ' · main checkout' : ''}`}</span>
          </span>
          <span className="truncate font-mono text-fg-muted">{row.info.path}</span>
          <span className="text-fg-muted">{row.stateLabel}</span>
          {row.claim !== null && <span className="text-fg-muted">{row.claim}</span>}
        </div>
        {!row.isMain && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={busy || row.state === 'missing'}
              title={row.state === 'missing' ? 'The checkout is missing' : 'Starts a fresh session using the same files and branch'}
              onClick={() => void newSessionHere()}
              className={SECONDARY}
            >
              New session here
            </button>
            <button type="button" disabled={!row.removable} title={row.claim ?? undefined} onClick={remove} className={QUIET}>
              Remove…
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 text-ui-sm">
        <span className="text-fg-muted">Sessions</span>
        {row.noSession ? (
          <span className="text-fg-faint">No session</span>
        ) : (
          <>
            {row.sessionIds.map((id) => (
              <button key={id} type="button" onClick={() => openSession(id)} className={`${QUIET} truncate text-left`}>
                {titleOf(id)}
              </button>
            ))}
            {row.terminalSessions > 0 && <span className="px-2.5 text-fg-muted">{plural(row.terminalSessions, 'terminal session')}</span>}
          </>
        )}
      </div>
    </li>
  );
}

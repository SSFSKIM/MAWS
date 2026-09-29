// The worktree cleanup (C10 execution document, "Cleanup state machine"; mockup 05 vignette 05; kept as its own layout
// because the owner's notes ask for the four-action ladder, D-20). One checkbox per step with its guard's reason when it
// cannot run: archive the idle sessions (never stops a process; the live ones and any `skipped_live` answer are named),
// remove a clean checkout, discard uncommitted changes and remove (behind an acknowledgement naming the count), delete
// the branch (after removal; unmerged behind an acknowledgement naming the commits). The identity git reported when the
// dialog opened is what every step expects; the steps run in order, each its own command, and a refusal stops at its
// step in words. The state is read again after each run, never cached.
import { useCallback, useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { cleanupState, type BranchStatus, type CleanupRefusal, type WorktreeStatus } from '@shared/sessions/worktree';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import type { SessionRecord } from '@shared/graph/session';
import type { CleanupTarget } from './dialogs';
import { archiveSession } from './record-ops';
import { holderWords } from './holder-words';
import { Sheet, SheetForm } from './Sheet';
import { DANGER, PRIMARY } from './ui';

interface Identity {
  repoRoot: string;
  path: string;
  branch: string | null;
  head: string | null; // null when the checkout was already gone at open
  branchHead: string | null;
}

interface Facts {
  status: WorktreeStatus | null;
  branch: BranchStatus | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

const MANAGED = '/.claude/worktrees/';

// The cleanup target of a session's worktree: a managed worktree's repository root is the part of its path before
// `.claude/worktrees/`, so it stays valid after the checkout is gone; a hand-made one is asked through the session's
// directory (main normalises any path inside a repository to the main root). Null for a session with no worktree.
export function cleanupTargetOf(record: SessionRecord): CleanupTarget | null {
  if (record.worktree === null) return null;
  const { path, branch } = record.worktree;
  const at = path.indexOf(MANAGED);
  return { repoRoot: at > 0 ? path.slice(0, at) : record.directory, path, branch };
}

// Git's identity of the target at open. The path is matched by main (NFC realpath on both sides, so `/tmp` and
// `/private/tmp` spellings meet) through `git.worktree.status`, never compared here; with no checkout listed any more,
// the record's branch is still read, so its leftover branch keeps its ladder step.
async function readIdentity(target: CleanupTarget): Promise<Identity | { error: string }> {
  const [list, status] = await Promise.all([
    ipc.invoke('git.worktree.list', { repoRoot: target.repoRoot }),
    ipc.invoke('git.worktree.status', { repoRoot: target.repoRoot, path: target.path }),
  ]);
  if (!list.ok) return { error: list.error.message };
  if (!status.ok) return { error: status.error.message };
  const repoRoot = list.value.repoRoot;
  const entry = status.value;
  const branchName = entry !== null ? entry.branch : target.branch;
  const branch = branchName === null ? null : await ipc.invoke('git.worktree.branch', { repoRoot, branch: branchName });
  return { repoRoot, path: entry?.path ?? target.path, branch: branchName, head: entry?.head ?? null, branchHead: branch?.ok ? (branch.value?.head ?? null) : null };
}

async function readFacts(identity: Identity): Promise<Facts | { error: string }> {
  const [status, branch] = await Promise.all([
    ipc.invoke('git.worktree.status', { repoRoot: identity.repoRoot, path: identity.path }),
    identity.branch === null ? Promise.resolve(null) : ipc.invoke('git.worktree.branch', { repoRoot: identity.repoRoot, branch: identity.branch }),
  ]);
  if (!status.ok) return { error: status.error.message };
  if (branch !== null && !branch.ok) return { error: branch.error.message };
  return { status: status.value, branch: branch?.value ?? null };
}

const refusalWords = (r: CleanupRefusal) => `${r.refused}: ${r.detail}`;

// The confirm button names exactly what is checked: "Archive 2, remove and delete branch".
export function confirmLabel(steps: { archive: number | null; remove: boolean; discard: boolean; deleteBranch: boolean }): string {
  const parts = [
    ...(steps.archive !== null ? [`archive ${steps.archive}`] : []),
    ...(steps.discard ? ['discard and remove'] : steps.remove ? ['remove'] : []),
    ...(steps.deleteBranch ? ['delete branch'] : []),
  ];
  if (parts.length === 0) return 'Clean up';
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return text[0]!.toUpperCase() + text.slice(1);
}

export function CleanupDialog({ target }: { target: CleanupTarget }) {
  const records = useSessions((s) => s.records);
  const engine = useSessions((s) => s.engine);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ appSessionId: AppSessionId; holder: string }[]>([]);
  const [checked, setChecked] = useState({ archive: false, remove: false, discard: false, deleteBranch: false });
  const [acks, setAcks] = useState({ discard: false, unmerged: false });
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async (id: Identity) => {
    const read = await readFacts(id);
    if ('error' in read) setError(read.error);
    else setFacts(read);
  }, []);

  useEffect(() => {
    let live = true;
    void readIdentity(target).then(async (id) => {
      if (!live) return;
      if ('error' in id) return setError(id.error);
      setIdentity(id);
      await refresh(id);
    });
    return () => {
      live = false;
    };
  }, [target, refresh]);

  const title = `Clean up worktree ${basename(target.path)}`;
  if (identity === null || facts === null)
    return (
      <Sheet title={title} width="w-[min(560px,92vw)]">
        <p className="m-0 text-fg-muted">{error ?? 'Reading the worktree…'}</p>
      </Sheet>
    );

  const state = cleanupState({ worktree: facts.status, branch: facts.branch });
  const occupancy = facts.status?.occupancy ?? null;
  const idle = occupancy?.idleAppSessionIds ?? [];
  const liveCount = occupancy ? occupancy.self + occupancy.foreign + occupancy.unbound : 0;
  const changes = facts.status ? facts.status.dirty.tracked + facts.status.dirty.untracked : 0;
  const titleOf = (id: AppSessionId) => records.get(id)?.title.text ?? id;
  const liveHolder = (id: AppSessionId) => {
    const process = engine.get(id)?.process;
    if (process !== undefined && process !== 'exited') return 'Working in MAWS';
    const record = records.get(id);
    return record ? holderWords(record.holder) : 'live';
  };
  const liveNamed = [...(occupancy?.liveAppSessionIds ?? []).map((id) => ({ appSessionId: id, holder: liveHolder(id) })), ...skipped.filter((s) => !(occupancy?.liveAppSessionIds ?? []).includes(s.appSessionId))];

  const stateLabel =
    state === 'busy' ? `busy · ${plural(liveCount, 'session')} live here` : state === 'dirty' ? `dirty · ${plural(changes, 'change')}` : state;
  const removeReason =
    state === 'clean' ? null : state === 'busy' ? `busy: ${plural(liveCount, 'session')} live here` : state === 'dirty' ? `dirty: ${plural(changes, 'change')}` : 'Nothing to remove';
  const discardReason =
    state === 'dirty' ? null : state === 'busy' ? `busy: ${plural(liveCount, 'session')} live here` : state === 'clean' ? 'Nothing to discard' : 'Nothing to remove';
  const removing = checked.remove || checked.discard;
  const branch = facts.branch;
  const checkedOutElsewhere = branch?.checkedOutAt != null && branch.checkedOutAt !== identity.path;
  const branchReason =
    branch === null
      ? null
      : state === 'busy'
        ? `busy: ${plural(liveCount, 'session')} live here`
        : checkedOutElsewhere
          ? `checked out at ${branch.checkedOutAt}`
          : state === 'detached' || removing
            ? null
            : 'After removal only';
  const unmerged = branch !== null && !branch.merged;
  const can = {
    archive: idle.length > 0,
    remove: removeReason === null,
    discard: state === 'dirty',
    deleteBranch: branch !== null && branchReason === null,
  };
  const steps = {
    archive: checked.archive && can.archive ? idle.length : null,
    remove: checked.remove && can.remove,
    discard: checked.discard && can.discard,
    deleteBranch: checked.deleteBranch && can.deleteBranch,
  };
  const ready =
    (steps.archive !== null || steps.remove || steps.discard || steps.deleteBranch) && (!steps.discard || acks.discard) && (!steps.deleteBranch || !unmerged || acks.unmerged) && !running;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      if (steps.archive !== null) {
        for (const id of idle) {
          const answer = await archiveSession(id, { onlyIfIdle: true });
          if ('skipped' in answer) setSkipped((list) => [...list, { appSessionId: id, holder: answer.skipped }]);
          else if ('error' in answer) return setError(`${titleOf(id)}: ${answer.error}`);
        }
      }
      if (steps.remove || steps.discard) {
        if (identity.head === null) return setError('missing: the checkout was already gone when this dialog opened');
        const removed = await ipc.invoke('git.worktree.remove', { repoRoot: identity.repoRoot, path: identity.path, expect: { branch: identity.branch, head: identity.head }, discard: steps.discard });
        if (!removed.ok) return setError(removed.error.message);
        if ('refused' in removed.value) return setError(`Remove refused · ${refusalWords(removed.value)}`);
      }
      // the step is offered only for a branch, so `branch` is set here; its head is null when the read at open found
      // no branch or failed, and the step's `expect` has nothing to hold git to
      if (steps.deleteBranch && identity.branch !== null) {
        if (identity.branchHead === null) return setError('Delete branch not run: the branch was not read when this dialog opened; close and reopen it');
        const deleted = await ipc.invoke('git.worktree.deleteBranch', { repoRoot: identity.repoRoot, branch: identity.branch, expect: { head: identity.branchHead }, acknowledgeUnmerged: acks.unmerged });
        if (!deleted.ok) return setError(deleted.error.message);
        if ('refused' in deleted.value) return setError(`Delete branch refused · ${refusalWords(deleted.value)}`);
      }
    } finally {
      setChecked({ archive: false, remove: false, discard: false, deleteBranch: false });
      setAcks({ discard: false, unmerged: false });
      await refresh(identity);
      setRunning(false);
    }
  };

  const toggle = (step: keyof typeof checked) => (event: React.ChangeEvent<HTMLInputElement>) => setChecked((c) => ({ ...c, [step]: event.target.checked }));

  return (
    <Sheet title={title} width="w-[min(560px,92vw)]">
      <SheetForm canSubmit={ready} onSubmit={() => void run()} submitLabel={confirmLabel(steps)} submitClass={steps.discard || (steps.deleteBranch && unmerged) ? DANGER : PRIMARY}>
        <div className="flex flex-col gap-0.5 text-ui-sm">
          <span className="font-mono break-all text-fg">{identity.path}</span>
          <span className="text-fg-muted">
            {identity.branch === null ? 'detached HEAD' : `⎇ ${identity.branch}`}
            {branch !== null && (branch.merged ? ` · merged into ${branch.base}` : ` · ${plural(branch.ahead, 'commit')} not on ${branch.base}`)}
            {` · ${stateLabel}`}
          </span>
        </div>

        <Step label="Archive sessions" checked={checked.archive} disabledReason={can.archive ? null : 'No idle sessions here'} onChange={toggle('archive')}>
          {`${plural(idle.length, 'idle session')} to archive`}
          {liveNamed.length + (occupancy?.unbound ?? 0) > 0 && (
            <div className="mt-1 flex flex-col gap-0.5">
              <span>{`Not archived: ${plural(liveNamed.length + (occupancy?.unbound ?? 0), 'live session')}; archive them from their rows`}</span>
              <ul aria-label="Not archived" className="m-0 list-disc pl-5">
                {liveNamed.map((s) => (
                  <li key={s.appSessionId}>{`${titleOf(s.appSessionId)} · ${s.holder}`}</li>
                ))}
                {(occupancy?.unbound ?? 0) > 0 && <li>{`${plural(occupancy!.unbound, 'session')} MAWS has not seen`}</li>}
              </ul>
            </div>
          )}
        </Step>
        <Step label="Remove checkout" checked={checked.remove} disabledReason={removeReason} onChange={toggle('remove')}>
          git worktree remove; needs a clean tree.
        </Step>
        <Step label="Discard changes and remove" checked={checked.discard} disabledReason={discardReason} onChange={toggle('discard')}>
          {state === 'dirty' ? `Throws away ${plural(changes, 'uncommitted change')}, then removes the checkout.` : 'Throws away uncommitted changes, then removes the checkout.'}
          {steps.discard && <Ack checked={acks.discard} onChange={(v) => setAcks((a) => ({ ...a, discard: v }))}>{`Discard ${plural(changes, 'uncommitted change')}; this cannot be undone`}</Ack>}
        </Step>
        {branch !== null && (
          <Step label="Delete branch" checked={checked.deleteBranch} disabledReason={branchReason} onChange={toggle('deleteBranch')}>
            {branch.merged ? `Every commit is on ${branch.base}; still not undoable.` : `${plural(branch.ahead, 'commit')} not on ${branch.base} are lost.`}
            {checked.deleteBranch && unmerged && (
              <Ack checked={acks.unmerged} onChange={(v) => setAcks((a) => ({ ...a, unmerged: v }))}>{`Delete ${plural(branch.ahead, 'commit')} not on ${branch.base}; this cannot be undone`}</Ack>
            )}
          </Step>
        )}
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}

function Step({ label, checked, disabledReason, onChange, children }: { label: string; checked: boolean; disabledReason: string | null; onChange(e: React.ChangeEvent<HTMLInputElement>): void; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-border px-2.5 py-2">
      <input type="checkbox" aria-label={label} checked={checked && disabledReason === null} disabled={disabledReason !== null} onChange={onChange} className="mt-0.5" />
      <div className="flex min-w-0 flex-col gap-0.5 text-ui-sm">
        <span className={disabledReason === null ? 'text-fg' : 'text-fg-faint'}>{label}</span>
        <div className="text-fg-muted">{children}</div>
        {disabledReason !== null && <span className="text-fg-faint">{disabledReason}</span>}
      </div>
    </div>
  );
}

function Ack({ checked, onChange, children }: { checked: boolean; onChange(v: boolean): void; children: React.ReactNode }) {
  return (
    <label className="mt-1 flex items-center gap-2 text-fg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

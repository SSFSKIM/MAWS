// Fork to a new worktree, a small sheet of the kind Codex uses for a worktree's branch name (C10 execution document,
// "The unstarted session", ForkSheet; D-20): the worktree name (prefilled `<yyyy-mm-dd>-<4 base32>`, not selected), the
// branch (New, following the name until edited, or Existing), and where it starts from (HEAD, a local branch, or a
// typed ref), validated as the intent's location is. Confirm forks and opens the fork's tab; a refusal (the path
// exists, the branch exists, the base is not found) keeps the sheet with the reason.
import { useEffect, useId, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { BranchChoice } from '@shared/sessions/intent';
import { defaultBranchName, validateWorktreeName } from '@shared/sessions/worktree';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { closeDialog } from './dialogs';
import { forkSession } from './record-ops';
import { Sheet, SheetForm } from './Sheet';
import { CHOICE, FIELD, PRIMARY } from './ui';
import { defaultWorktreeName } from './useSetupIntent';

export function ForkSheet({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const [name, setName] = useState(() => defaultWorktreeName());
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [branchName, setBranchName] = useState<string | null>(null); // null: follows the name
  const [existing, setExisting] = useState('');
  const [base, setBase] = useState('HEAD');
  const [branches, setBranches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const directory = record?.directory ?? null;

  useEffect(() => {
    if (directory === null) return;
    let live = true;
    void ipc.invoke('git.branches', { directory }).then((result) => {
      if (live && result.ok) setBranches(result.value.branches.map((b) => b.name));
    });
    return () => {
      live = false;
    };
  }, [directory]);

  if (record === null) return null;
  const nameProblem = validateWorktreeName(name);
  const newBranch = branchName ?? defaultBranchName(name);
  const branch: BranchChoice = mode === 'new' ? { kind: 'new', name: newBranch.trim(), base: base.trim() || 'HEAD' } : { kind: 'existing', name: existing };
  const valid = nameProblem === null && branch.name.length > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const answer = await forkSession(appSessionId, { kind: 'newWorktree', name, branch });
    setBusy(false);
    if (answer.ok) closeDialog();
    else setError(answer.error);
  };

  return (
    <Sheet title="Fork to a new worktree">
      <SheetForm canSubmit={valid && !busy} onSubmit={() => void submit()} submitLabel={busy ? 'Forking…' : 'Fork'} submitClass={PRIMARY}>
        <p className="m-0 text-ui-sm text-fg-muted">from {record.title.text}</p>
        <label className="flex flex-col gap-1 text-ui-sm text-fg-muted">
          Worktree
          <input
            aria-label="Worktree name"
            autoFocus
            value={name}
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
            onChange={(e) => setName(e.target.value)}
            className={FIELD}
          />
          <span className="font-mono">.claude/worktrees/{name.replaceAll('/', '+')}</span>
          {nameProblem && name.length > 0 && <span className="text-danger">{nameProblem}</span>}
        </label>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0 text-ui-sm text-fg-muted">
          <legend className="mb-1 p-0">Branch</legend>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-fg">
              <input type="radio" name="branch-mode" checked={mode === 'new'} onChange={() => setMode('new')} className={CHOICE} />
              New
            </label>
            <label className="flex items-center gap-1.5 text-fg">
              <input type="radio" name="branch-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} className={CHOICE} />
              Existing
            </label>
          </div>
          {mode === 'new' ? (
            <>
              <input aria-label="New branch" value={newBranch} onChange={(e) => setBranchName(e.target.value)} className={FIELD} />
              <label className="flex flex-col gap-1">
                Start from
                <input aria-label="Start from" list={listId} value={base} onChange={(e) => setBase(e.target.value)} className={FIELD} />
                <datalist id={listId}>
                  <option value="HEAD" />
                  {branches.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </label>
            </>
          ) : (
            <select aria-label="Existing branch" value={existing} onChange={(e) => setExisting(e.target.value)} className={FIELD}>
              <option value="">Choose a branch</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
        </fieldset>
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}

// The commit form (E6 execution document, Design §5, T3.3): the message (the tool's per-session draft), ⌘Enter, the
// per-commit Skip hooks toggle (`--no-verify`; residue 1: a decision per commit, not a setting), the Commit button with
// the reason it is disabled, and the last commit's `abc1234 · subject` line. A refusal (a failing hook included) lands
// in the tool's notice, where its output is behind a disclosure; the draft stays until a commit lands.
import { useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import { CHOICE, FIELD, PRIMARY } from '../../sessions/ui';
import { SCM_COPY } from './copy';
import type { ScmGroups } from './groups';
import { useScm } from './store';
import type { ScmUi } from './view-state';

// Why Commit cannot run now, in the order the owner would fix it; null when it can, '' while the trust is not known yet
// (blocked, with nothing to say). Main applies the same rules (Design §3), so this only spares a round trip and says why.
export function commitBlocked(input: { trusted: boolean | null; groups: ScmGroups; message: string }): string | null {
  if (input.trusted !== true) return input.trusted === false ? SCM_COPY.commitBlocked.untrusted : '';
  if (input.groups.conflicts.length > 0) return SCM_COPY.commitBlocked.conflicts;
  if (input.groups.staged.length === 0) return SCM_COPY.commitBlocked.nothingStaged;
  if (input.message.trim() === '') return SCM_COPY.commitBlocked.emptyMessage;
  return null;
}

export function CommitForm({ appSessionId, ui, groups, trusted }: { appSessionId: AppSessionId; ui: StoreApi<ScmUi>; groups: ScmGroups; trusted: boolean | null }) {
  const message = useStore(ui, (s) => s.message);
  const noVerify = useStore(ui, (s) => s.noVerify);
  const lastCommit = useStore(ui, (s) => s.lastCommit);
  const [committing, setCommitting] = useState(false);
  const blocked = commitBlocked({ trusted, groups, message });
  const canCommit = blocked === null && !committing;

  const commit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    try {
      await useScm.getState().commit(ui, appSessionId);
    } finally {
      setCommitting(false);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !event.metaKey || event.nativeEvent.isComposing) return; // an IME's Enter commits the composition
    event.preventDefault();
    void commit();
  };

  return (
    <div data-scm-commit className="flex shrink-0 flex-col gap-1.5 border-t border-border px-3 py-2">
      <textarea
        aria-label={SCM_COPY.commitMessage}
        placeholder={SCM_COPY.commitMessage}
        rows={3}
        value={message}
        onChange={(event) => ui.setState({ message: event.target.value })}
        onKeyDown={keyDown}
        className={`${FIELD} resize-y`}
      />
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
          <input type="checkbox" checked={noVerify} onChange={(event) => ui.setState({ noVerify: event.target.checked })} className={CHOICE} />
          <span>
            {SCM_COPY.skipHooks} (<code className="font-mono">{SCM_COPY.noVerify}</code>)
          </span>
        </label>
        <span className="flex-1" />
        {blocked ? (
          <span data-scm-commit-reason className="truncate text-ui-sm text-fg-faint">
            {blocked}
          </span>
        ) : null}
        <button type="button" disabled={!canCommit} title={blocked || SCM_COPY.commitShortcut} onClick={() => void commit()} className={PRIMARY}>
          {committing ? SCM_COPY.committing : SCM_COPY.commit}
        </button>
      </div>
      {lastCommit !== null ? (
        <p data-scm-last-commit className="m-0 truncate font-mono text-ui-sm text-fg-muted" title={lastCommit.subject}>
          {SCM_COPY.lastCommit(lastCommit.sha, lastCommit.subject)}
        </p>
      ) : null}
    </div>
  );
}

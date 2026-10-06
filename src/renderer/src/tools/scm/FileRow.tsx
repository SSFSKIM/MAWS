// One row of a Source control group (E6 execution document, Design §5; M3's decisions): a button that selects the file
// (its change letter, name and directory), and the group's actions as icon buttons whose labels name the file, shown on
// hover, focus and selection. Staged: Unstage; Unstaged: Stage, Discard…; Untracked: Stage, Delete…; Conflicts: Mark
// resolved (a stage) and Open file, never a discard. Every row whose file exists offers Open file ↗ through C8c's
// `openFile`. The git actions are disabled together (an untrusted checkout); opening a file is a read.
import type { ScmDiscardInput } from '@shared/ipc/schema/scm';
import { SCM_COPY } from './copy';
import type { ScmChange, ScmEntry, ScmGroupName, ScmSelection } from './groups';

export interface RowActions {
  select(selection: ScmSelection): void;
  stage(paths: string[]): void;
  unstage(paths: string[]): void;
  discard(entries: ScmDiscardInput['entries']): void; // opens the sheet
  open(path: string): void;
}

const basename = (path: string) => {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) + (trimmed === path ? '' : '/');
};
const dirOf = (path: string) => {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.includes('/') ? trimmed.slice(0, trimmed.lastIndexOf('/')) : '';
};

const LETTER_TONE: Record<ScmChange, string> = {
  modified: 'text-warning',
  added: 'text-success',
  deleted: 'text-danger',
  renamed: 'text-info',
  copied: 'text-info',
  'type-changed': 'text-warning',
  untracked: 'text-success',
  'both-modified': 'text-danger',
  'both-added': 'text-danger',
  'both-deleted': 'text-danger',
  'added-by-one-side': 'text-danger',
  'deleted-by-one-side': 'text-danger',
};

// A file the working tree holds, so the viewer can open it: not a deletion, not a directory entry.
export const openable = (entry: ScmEntry) => entry.change !== 'deleted' && entry.change !== 'both-deleted' && !entry.path.endsWith('/');

export function changeWords(entry: ScmEntry): string {
  if (entry.change === 'renamed' && entry.oldPath !== null) return SCM_COPY.renamedFrom(entry.oldPath);
  if (entry.change === 'copied' && entry.oldPath !== null) return SCM_COPY.copiedFrom(entry.oldPath);
  return SCM_COPY.changes[entry.change];
}

const icon = 'flex size-5 shrink-0 items-center justify-center rounded-sm text-ui text-fg-muted hover:bg-bg-active hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

function Action({ label, glyph, git = true, enabled, onClick }: { label: string; glyph: string; git?: boolean; enabled: boolean; onClick(): void }) {
  return (
    <button type="button" aria-label={label} title={label} data-scm-action={git || undefined} disabled={git && !enabled} onClick={onClick} className={icon}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

export function FileRow({ group, entry, selected, enabled, actions }: { group: ScmGroupName; entry: ScmEntry; selected: boolean; enabled: boolean; actions: RowActions }) {
  const { path } = entry;
  return (
    <li data-scm-row data-path={path} data-selected={selected || undefined} className={`group flex h-6 items-center pr-2 hover:bg-bg-hover ${selected ? 'bg-bg-active' : ''}`}>
      <button type="button" data-scm-select aria-current={selected || undefined} title={path} onClick={() => actions.select({ group, path })} className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 text-left text-ui text-fg">
        <span data-change={entry.change} title={changeWords(entry)} className={`w-3 shrink-0 text-center font-mono text-ui-sm ${LETTER_TONE[entry.change]}`}>
          {SCM_COPY.letters[entry.change]}
        </span>
        <span className="truncate">{basename(path)}</span>
        <span className="min-w-0 flex-1 truncate text-ui-sm text-fg-faint">{dirOf(path)}</span>
      </button>
      <span className={`flex shrink-0 items-center gap-0.5 ${selected ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}>
        {group === 'staged' ? <Action label={SCM_COPY.unstage(path)} glyph="−" enabled={enabled} onClick={() => actions.unstage([path])} /> : null}
        {group === 'unstaged' ? (
          <>
            <Action label={SCM_COPY.discard(path)} glyph="↺" enabled={enabled} onClick={() => actions.discard([{ path, group: 'unstaged' }])} />
            <Action label={SCM_COPY.stage(path)} glyph="+" enabled={enabled} onClick={() => actions.stage([path])} />
          </>
        ) : null}
        {group === 'untracked' ? (
          <>
            <Action label={SCM_COPY.delete(path)} glyph="×" enabled={enabled} onClick={() => actions.discard([{ path, group: 'untracked' }])} />
            <Action label={SCM_COPY.stage(path)} glyph="+" enabled={enabled} onClick={() => actions.stage([path])} />
          </>
        ) : null}
        {group === 'conflicts' ? <Action label={SCM_COPY.markResolved(path)} glyph="✓" enabled={enabled} onClick={() => actions.stage([path])} /> : null}
        {openable(entry) ? <Action label={SCM_COPY.open(path)} glyph="↗" git={false} enabled onClick={() => actions.open(path)} /> : null}
      </span>
    </li>
  );
}

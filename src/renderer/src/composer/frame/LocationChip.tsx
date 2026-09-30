// The chip row's location (C7 execution document, "Composer frame" Location): the directory's or worktree's name (the
// path in the popover and the tooltip), with its branch and a dirty marker. Its popover offers the project directory,
// a new worktree with a name and the branch it starts from, each existing worktree with its branch and how many
// sessions run there, and the branch picker (a search over the branches with a create action), and lists the
// additional directories with copy. Under a live engine every choice is read-only (the location is fixed once the
// session starts); under an unstarted session's intent every choice writes through the binding.
import { Popover } from 'radix-ui';
import { useMemo, useState } from 'react';
import { useCommand } from '../../ipc/query';
import { formatCwd } from '../../session/StatusLine';
import { useSessions } from '../../stores/sessions';
import { locationPath, type Location } from '../setup-intent';
import type { ChipBinding } from './bindings';
import { CHIP, ITEM, NOTE, POPOVER } from './chip-style';

export interface LocationChipProps {
  location: ChipBinding<Location, Location>;
  branch: ChipBinding<string | null, string>;
  directories: readonly string[];
  dirty: boolean;
  onOpen?(): void; // the popover lists the engine's directories: read them when it opens
}

const sameLocation = (a: Location, b: Location) => a.kind === b.kind && locationPath(a) === locationPath(b);

// The last segment of the home-abbreviated path: `~` for the home directory itself.
export const directoryName = (path: string): string => formatCwd(path).split('/').filter(Boolean).at(-1) ?? path;

const sessionCount = (n: number) => (n === 0 ? 'no sessions' : n === 1 ? '1 session' : `${n} sessions`);

// What the popover says of an existing worktree: its branch (from `git.worktree.list`, read while the popover is open)
// and the sessions MAWS knows there, archived ones aside.
interface WorktreeFacts {
  branch: string | null | undefined; // undefined: not read yet; null: a detached checkout
  sessions: number;
}

function useWorktreeFacts(options: readonly Location[], open: boolean): (path: string) => WorktreeFacts {
  const repoRoot = options.find((o): o is Extract<Location, { kind: 'existingWorktree' }> => o.kind === 'existingWorktree')?.repoRoot ?? null;
  const listed = useCommand('git.worktree.list', { repoRoot: repoRoot ?? '' }, { enabled: open && repoRoot !== null, staleTime: 30_000 });
  const records = useSessions((s) => s.records);
  const counts = useMemo(() => {
    const byPath = new Map<string, number>();
    for (const r of records.values()) {
      if (r.archived) continue;
      const path = r.worktree?.path ?? r.directory;
      byPath.set(path, (byPath.get(path) ?? 0) + 1);
    }
    return byPath;
  }, [records]);
  return (path) => ({ branch: listed.data?.worktrees.find((w) => w.path === path)?.branch, sessions: counts.get(path) ?? 0 });
}

function optionLabel(location: Location, facts: (path: string) => WorktreeFacts): { title: string; detail: string } {
  switch (location.kind) {
    case 'directory':
      return { title: 'Project directory', detail: formatCwd(location.path) };
    case 'existingWorktree': {
      const { branch, sessions } = facts(location.path);
      const on = branch === undefined ? [] : [branch === null ? 'detached' : `⎇ ${branch}`];
      return { title: 'Existing worktree', detail: [directoryName(location.path), ...on, sessionCount(sessions)].join(' · ') };
    }
    case 'newWorktree':
      return { title: 'New worktree', detail: `${location.name} · ${location.branch.name}` };
  }
}

const FIELD = 'rounded-sm border border-border-strong bg-bg px-1.5 py-0.5 text-ui text-fg';

// A new worktree's name and, for a new branch, where it starts from (HEAD or a local branch).
function NewWorktree({ template, bases, disabled, choose }: { template: Extract<Location, { kind: 'newWorktree' }>; bases: readonly string[]; disabled: boolean; choose(l: Location): void }) {
  const [name, setName] = useState(template.name);
  const [base, setBase] = useState(template.branch.kind === 'new' ? template.branch.base : 'HEAD');
  const valid = /^[A-Za-z0-9._-]+$/.test(name);
  const starts = ['HEAD', ...bases.filter((b) => b !== 'HEAD')];
  if (!starts.includes(base)) starts.push(base); // a base the intent holds that is no local branch now
  return (
    <form
      className="flex items-end gap-1 px-2 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) choose({ ...template, name, branch: template.branch.kind === 'new' ? { kind: 'new', name: `worktree-${name}`, base } : template.branch });
      }}
    >
      <label className="flex min-w-0 flex-1 flex-col text-ui-sm text-fg-muted">
        New worktree
        <input aria-label="New worktree name" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} className={`${FIELD} font-mono`} />
      </label>
      {template.branch.kind === 'new' && (
        <label className="flex min-w-0 flex-1 flex-col text-ui-sm text-fg-muted">
          Start from
          <select aria-label="Start from" value={base} disabled={disabled} onChange={(e) => setBase(e.target.value)} className={`${FIELD} font-mono`}>
            {starts.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={disabled || !valid} className={CHIP}>
        Use
      </button>
    </form>
  );
}

function BranchPicker({ branch }: { branch: ChipBinding<string | null, string> }) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shown = branch.options.filter((b) => b.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12);
  const choose = async (name: string) => {
    const result = await branch.set(name);
    setError(result.ok ? null : result.error);
  };
  const create = query.trim() !== '' && !branch.options.includes(query.trim());
  return (
    <div className="flex flex-col gap-0.5">
      <p className={NOTE}>Branch · {branch.value ?? '—'}</p>
      <input
        aria-label="Search branches"
        placeholder="Search branches"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mx-2 rounded-sm border border-border-strong bg-bg px-1.5 py-0.5 text-ui text-fg"
      />
      <div role="menu" aria-label="Branches" className="flex flex-col">
        {shown.map((name) => (
          <button key={name} type="button" role="menuitemradio" aria-checked={name === branch.value} disabled={branch.disabled !== null} onClick={() => void choose(name)} className={`${ITEM} font-mono`}>
            {name}
          </button>
        ))}
        {create && (
          <button type="button" role="menuitem" disabled={branch.disabled !== null} onClick={() => void choose(query.trim())} className={ITEM}>
            Create branch <span className="font-mono">{query.trim()}</span>
          </button>
        )}
      </div>
      {branch.disabled && <p className={NOTE}>{branch.disabled}</p>}
      {error && (
        <p role="alert" className="px-2 text-ui-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function LocationChip({ location, branch, directories, dirty, onOpen }: LocationChipProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const path = locationPath(location.value);
  const facts = useWorktreeFacts(location.options, open);
  const choose = async (next: Location) => {
    const result = await location.set(next);
    setError(result.ok ? null : result.error);
    if (result.ok) setOpen(false);
  };
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen?.();
        setOpen(next);
      }}
    >
      <Popover.Trigger aria-label={`Location ${path}`} title={location.disabled ? `${path} · ${location.disabled}` : path} className={`${CHIP} font-mono`}>
        <span className="truncate">{directoryName(path)}</span>
        <span className="shrink-0 text-fg-faint">·</span>
        <span className="shrink-0 truncate">{branch.value === null ? '—' : `⎇ ${branch.value}`}</span>
        {dirty && (
          <span aria-label="uncommitted changes" className="shrink-0 text-warning">
            ●
          </span>
        )}
        <span aria-hidden className="shrink-0 text-fg-faint">⌄</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Location" side="top" align="start" sideOffset={6} collisionPadding={8} className={`${POPOVER} flex w-80 flex-col gap-1`}>
          <p className="px-2 pt-1 font-mono text-ui-sm break-all">{path}</p>
          <div role="menu" aria-label="Where this session runs" className="flex flex-col">
            {location.options
              .filter((o) => o.kind !== 'newWorktree')
              .map((option) => {
                const { title, detail } = optionLabel(option, facts);
                return (
                  <button
                    key={`${option.kind}:${locationPath(option)}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sameLocation(option, location.value)}
                    title={locationPath(option)}
                    disabled={location.disabled !== null}
                    onClick={() => void choose(option)}
                    className={ITEM}
                  >
                    <span>{title}</span>
                    <span className="font-mono text-ui-sm text-fg-muted">{detail}</span>
                  </button>
                );
              })}
          </div>
          {location.options
            .filter((o): o is Extract<Location, { kind: 'newWorktree' }> => o.kind === 'newWorktree')
            .slice(0, 1)
            .map((template) => (
              <NewWorktree key="new" template={template} bases={branch.options} disabled={location.disabled !== null} choose={(l) => void choose(l)} />
            ))}
          {location.disabled && <p className={NOTE}>{location.disabled}</p>}
          {error && (
            <p role="alert" className="px-2 text-ui-sm text-danger">
              {error}
            </p>
          )}
          <div className="my-1 h-px bg-border" />
          <BranchPicker branch={branch} />
          {directories.length > 0 && (
            <>
              <div className="my-1 h-px bg-border" />
              <p className={NOTE}>Additional directories</p>
              <ul aria-label="Additional directories" className="m-0 flex list-none flex-col p-0">
                {directories.map((d) => (
                  <li key={d} className="flex items-center gap-1 px-2 py-0.5 text-ui-sm">
                    <span className="min-w-0 flex-1 truncate font-mono" title={d}>
                      {formatCwd(d)}
                    </span>
                    <button type="button" className={CHIP} onClick={() => copy(d)}>
                      {copied === d ? 'Copied' : 'Copy'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

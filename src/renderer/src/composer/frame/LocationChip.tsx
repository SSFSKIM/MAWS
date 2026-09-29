// The chip row's location (C7 execution document, "Composer frame" Location): the directory or worktree, home-
// abbreviated, with its branch and a dirty marker. Its popover offers the project directory, a new worktree with a
// name, an existing worktree, and the branch picker (a search over the branches with a create action), and lists the
// additional directories with copy. Under a live engine every choice is read-only ("Arrives with C10"); under an
// unstarted session's intent every choice writes through the binding.
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { formatCwd } from '../../session/StatusLine';
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

function optionLabel(location: Location): { title: string; detail: string } {
  switch (location.kind) {
    case 'directory':
      return { title: 'Project directory', detail: formatCwd(location.path) };
    case 'existingWorktree':
      return { title: 'Existing worktree', detail: formatCwd(location.path) };
    case 'newWorktree':
      return { title: 'New worktree', detail: `${location.name} · ${location.branch.name}` };
  }
}

function NewWorktree({ template, disabled, choose }: { template: Extract<Location, { kind: 'newWorktree' }>; disabled: boolean; choose(l: Location): void }) {
  const [name, setName] = useState(template.name);
  const valid = /^[A-Za-z0-9._-]+$/.test(name);
  return (
    <form
      className="flex items-center gap-1 px-2 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) choose({ ...template, name, branch: template.branch.kind === 'new' ? { ...template.branch, name: `worktree-${name}` } : template.branch });
      }}
    >
      <label className="flex min-w-0 flex-1 flex-col text-ui-sm text-fg-muted">
        New worktree
        <input aria-label="New worktree name" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} className="rounded-sm border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-ui text-fg" />
      </label>
      <button type="submit" disabled={disabled || !valid} className={`${CHIP} self-end`}>
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
        <span className="truncate">{formatCwd(path)}</span>
        <span className="shrink-0 text-fg-faint">·</span>
        <span className="shrink-0 truncate">{branch.value ?? '—'}</span>
        {dirty && (
          <span aria-label="uncommitted changes" className="shrink-0 text-warning">
            ●
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Location" side="top" align="start" sideOffset={6} collisionPadding={8} className={`${POPOVER} flex w-80 flex-col gap-1`}>
          <p className="px-2 pt-1 font-mono text-ui-sm break-all">{path}</p>
          <div role="menu" aria-label="Where this session runs" className="flex flex-col">
            {location.options
              .filter((o) => o.kind !== 'newWorktree')
              .map((option) => {
                const { title, detail } = optionLabel(option);
                return (
                  <button key={`${option.kind}:${locationPath(option)}`} type="button" role="menuitemradio" aria-checked={sameLocation(option, location.value)} disabled={location.disabled !== null} onClick={() => void choose(option)} className={ITEM}>
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
              <NewWorktree key="new" template={template} disabled={location.disabled !== null} choose={(l) => void choose(l)} />
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

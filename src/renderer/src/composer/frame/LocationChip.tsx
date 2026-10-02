// The toolbar's location (C7 execution document, "Composer frame" Location; W2: in the toolbar, no chip row): the directory's or worktree's name (the
// path in the popover and the tooltip), with its branch and a dirty marker. A started session's, and read-only: where a
// session runs is fixed once it starts. Its popover shows the full path and lists the additional directories with copy.
// New chat (2026-10-01, the owner's ruling): an unstarted tab chooses its project and worktree in the row above the box
// (`ProjectRow`), and the popover no longer lists worktrees or branches: the agent checks out a worktree or makes a
// branch when asked.
import { Popover } from 'radix-ui';
import { useState } from 'react';
import type { LocationView } from './bindings';
import { CHIP, NOTE, POPOVER } from './chip-style';

export interface LocationChipProps {
  location: LocationView;
  directories: readonly string[];
  dirty: boolean;
  onOpen?(): void; // the popover lists the engine's directories: read them when it opens
}

// macOS homes live under /Users/<name>; the renderer is told no home directory, and needs none for this (W2: moved here
// from the status line, which is gone).
export const formatCwd = (directory: string): string => directory.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
// The last segment of the home-abbreviated path: `~` for the home directory itself.
export const directoryName = (path: string): string => formatCwd(path).split('/').filter(Boolean).at(-1) ?? path;

export function LocationChip({ location, directories, dirty, onOpen }: LocationChipProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const { path, branch, note } = location;
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
      <Popover.Trigger aria-label={`Location ${path}`} title={`${path} · ${note}`} className={`${CHIP} font-mono`}>
        <span className="truncate">{directoryName(path)}</span>
        {/* W9 (H2): no branch to name (a non-repository, or git has not answered) shows no label, not a placeholder */}
        {branch !== null && (
          <>
            <span className="shrink-0 text-fg-faint">·</span>
            <span className="shrink-0 truncate">⎇ {branch}</span>
          </>
        )}
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
          <p className={NOTE}>{note}</p>
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

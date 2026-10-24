import { Popover } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import { IconButton } from '../app/IconButton';
import { projectLabels } from './project-labels';

export function ProjectFilter({ projects, current, selected, onChange }: {
  projects: readonly ProjectRecord[];
  current: ProjectId | null;
  selected: ReadonlySet<ProjectId> | null;
  onChange(value: ReadonlySet<ProjectId> | null): void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const content = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => projectLabels(projects), [projects]);
  const enter = () => { clearTimeout(timer.current); setOpen(true); };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!content.current?.contains(document.activeElement)) setOpen(false); }, 150);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild>
      <IconButton label="Filter projects" aria-haspopup="dialog" aria-expanded={open} aria-pressed={selected !== null}
        onPointerEnter={enter} onPointerLeave={leave}
        onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); enter(); requestAnimationFrame(() => content.current?.querySelector<HTMLInputElement>('input')?.focus()); } }}
        onClick={() => { if (selected) onChange(null); else if (current) onChange(new Set([current])); else enter(); }} className="size-[22px]">
        <svg viewBox="0 0 16 16" aria-hidden className="size-[13px] fill-none stroke-current [stroke-linejoin:round] [stroke-width:1.5]"><path d="M2 3h12L9 8v4l-2 1V8z" /></svg>
      </IconButton>
    </Popover.Anchor>
    <Popover.Portal><Popover.Content ref={content} aria-label="Filter projects" side="right" align="start" sideOffset={8}
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onPointerEnter={enter} onPointerLeave={leave}
      className="z-50 max-h-[60vh] min-w-48 overflow-auto rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
      <button type="button" onClick={() => onChange(null)} className="w-full rounded-sm px-2 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2">All projects</button>
      {projects.map((p) => <label key={p.id} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-bg-hover">
        <input type="checkbox" checked={selected?.has(p.id) ?? false} className="accent-accent outline-accent focus-visible:outline-2"
          onChange={(event) => { const next = new Set(selected ?? []); if (event.target.checked) next.add(p.id); else next.delete(p.id); onChange(next.size ? next : null); }} />
        <span title={p.directory}>{labels.get(p.id)}</span>
      </label>)}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

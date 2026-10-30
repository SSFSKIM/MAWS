import { Popover } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectRecord } from '@shared/ipc/schema';
import { IconButton } from '../app/IconButton';
import { orgKeyOf, type OrgIndex, type RowKey } from '../stores/org-projects';
import { projectLabels } from './project-labels';

// P5 O6 M5: the filter chooses org projects, each once whatever machines hold it; choosing one no checkout lists (a
// folder only discovered) lists it while it is chosen.
export function ProjectFilter({ projects, index, current, selected, onChange }: {
  projects: readonly ProjectRecord[]; // every machine's, not hidden
  index: OrgIndex;
  current: RowKey | null;
  selected: ReadonlySet<RowKey> | null;
  onChange(value: ReadonlySet<RowKey> | null): void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const content = useRef<HTMLDivElement>(null);
  // one entry per org project, named as its row is, the first of its projects standing for it
  const options = useMemo(() => {
    const seen = new Map<RowKey, ProjectRecord>();
    for (const p of projects) if (!seen.has(orgKeyOf(p))) seen.set(orgKeyOf(p), { ...p, name: index.orgs.get(orgKeyOf(p))?.name ?? p.name });
    const labels = projectLabels([...seen.values()]);
    return [...seen].map(([key, p]) => ({ key, label: labels.get(p.id)!, title: p.directory }));
  }, [projects, index]);
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
      {options.map((o) => <label key={o.key} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-bg-hover">
        <input type="checkbox" checked={selected?.has(o.key) ?? false} className="accent-accent outline-accent focus-visible:outline-2"
          onChange={(event) => { const next = new Set(selected ?? []); if (event.target.checked) next.add(o.key); else next.delete(o.key); onChange(next.size ? next : null); }} />
        <span title={o.title}>{o.label}</span>
      </label>)}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

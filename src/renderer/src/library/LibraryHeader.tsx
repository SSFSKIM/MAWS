// The Artifacts tab's head (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4): the page's title and the view switch
// (All, Pinned, By Space) at the left, as the plugin library's title and switch sit; at the right the search ("Search
// artifacts": titles and text, main's index), the type filter (All types and the seven kinds, each with the count the
// view and search would give it) and New Space.
import { DropdownMenu, ToggleGroup } from 'radix-ui';
import { ARTIFACT_KINDS, type ArtifactKind } from '@shared/artifacts/entity';
import type { LibraryCounts } from '@shared/ipc/schema/library';
import { ChevronDownIcon, Icon, PlusIcon } from '../app/IconButton';
import { SECONDARY } from '../sessions/ui';
import { SearchField } from '../widgets/plugins/LibraryHeader';
import { KIND_PLURAL_LABELS, LIBRARY_PAGE as P } from './copy';
import { openLibraryDialog } from './dialogs';
import { KindIcon } from './icons';
import { setLibraryView, useLibraryView, type LibraryViewName } from './view';

const VIEWS: readonly LibraryViewName[] = ['all', 'pinned', 'bySpace'];
export const MENU = 'z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float';
export const MENU_ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';
const ALL = 'all'; // the radio value of All types (no kind is it)

function ViewSwitch() {
  const view = useLibraryView((s) => s.view);
  const item = 'h-6 rounded-sm px-2.5 text-ui text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 data-[state=on]:bg-bg data-[state=on]:text-fg data-[state=on]:ring-1 data-[state=on]:ring-border';
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={P.viewLabel}
      value={view}
      // a click on the view shown emits '' (Radix's single group unpressing it): By Space returns to every Space
      onValueChange={(next) => setLibraryView({ view: next === '' ? view : (next as LibraryViewName), spaceId: null })}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-bg-active p-0.5"
    >
      {VIEWS.map((v) => (
        <ToggleGroup.Item key={v} value={v} className={item}>
          {P.views[v]}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

const CheckIcon = () => (
  <Icon className="size-3.5">
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);

function TypeFilter({ counts }: { counts: LibraryCounts | undefined }) {
  const kind = useLibraryView((s) => s.kind);
  const label = kind === null ? P.allTypes : KIND_PLURAL_LABELS[kind];
  const total = counts ? ARTIFACT_KINDS.reduce((sum, k) => sum + counts[k], 0) : undefined;
  const choice = (value: string, text: string, count: number | undefined, icon?: ArtifactKind) => (
    <DropdownMenu.RadioItem key={value} value={value} className={MENU_ITEM}>
      <span aria-hidden className="flex w-3.5 shrink-0 text-accent">
        <DropdownMenu.ItemIndicator>
          <CheckIcon />
        </DropdownMenu.ItemIndicator>
      </span>
      {icon && <KindIcon kind={icon} className="size-3.5 text-fg-muted" />}
      <span className="flex-1">{text}</span>
      <span className={`pl-4 text-ui-sm tabular-nums ${count === 0 ? 'text-fg-faint' : 'text-fg-muted'}`}>{count ?? ''}</span>
    </DropdownMenu.RadioItem>
  );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${P.typeFilter}: ${label}`}
          title={P.typeFilter}
          aria-pressed={kind !== null}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-ui text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:border-border-strong aria-pressed:text-fg data-[state=open]:bg-bg-active"
        >
          {kind !== null && <KindIcon kind={kind} className="size-3.5" />}
          {label}
          <ChevronDownIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          <DropdownMenu.RadioGroup value={kind ?? ALL} onValueChange={(next) => setLibraryView({ kind: next === ALL ? null : (next as ArtifactKind) })}>
            {choice(ALL, P.allTypes, total)}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            {ARTIFACT_KINDS.map((k) => choice(k, KIND_PLURAL_LABELS[k], counts?.[k], k))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function LibraryHeader({ counts }: { counts: LibraryCounts | undefined }) {
  const query = useLibraryView((s) => s.query);
  return (
    <div data-library-header className="shrink-0 border-b border-border">
      <div className="mx-auto flex max-w-(--measure-wide) flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3">
        <h1 className="m-0 text-ui font-semibold text-fg">{P.title}</h1>
        <ViewSwitch />
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          <SearchField label={P.search} value={query} onChange={(next) => setLibraryView({ query: next })} />
          <TypeFilter counts={counts} />
          <button type="button" onClick={() => openLibraryDialog({ kind: 'newSpace' })} className={`${SECONDARY} inline-flex h-7 items-center gap-1 text-ui`}>
            <PlusIcon className="size-3.5" />
            {P.newSpace}
          </button>
        </span>
      </div>
    </div>
  );
}

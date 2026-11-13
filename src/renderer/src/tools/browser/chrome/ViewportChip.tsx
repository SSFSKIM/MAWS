// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D, §G): a device size in the chrome. `ViewportChoices`
// is the three radio items, Responsive, Mobile and Tablet, both in Browser options › Viewport and under the chip; their
// mark is the tab's `viewport` as main last listed it (no state of its own: two surfaces showing the tab agree, and a
// refused change leaves the old mark), and a size whose width does not fit this mount's room at the page's zoom is
// disabled with "Wider than this pane". `ViewportChip`, in the navigation row while a size is on, reads the page's real
// size (`pageBox`'s `reads`, so in a pane shorter than the size its height is the pane's) and opens the same choices.
import { DropdownMenu } from 'radix-ui';
import { BROWSER_VIEWPORTS, type BrowserTab, type BrowserViewport } from '@shared/browser/tab';
import { setViewport } from '../actions';
import { BROWSER_COPY } from '../copy';
import { CheckIcon } from '../icons';
import { fits, pageBox, type Room } from '../viewport';

const V = BROWSER_COPY.viewport;
const MENU_ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';
const MENU = 'z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg';

type ChoiceId = 'responsive' | (typeof BROWSER_VIEWPORTS)[number]['id'];
const CHOICES: readonly { id: ChoiceId; label: string; viewport: BrowserViewport | null }[] = [
  { id: 'responsive', label: V.responsive, viewport: null },
  ...BROWSER_VIEWPORTS.map(({ id, width, height }) => ({ id, label: V[id], viewport: { width, height } })),
];

// The choice the tab's size is; '' (no mark) for a size the menu does not list.
const choiceOf = (viewport: BrowserViewport | null): ChoiceId | '' =>
  CHOICES.find((choice) => (choice.viewport === null ? viewport === null : viewport !== null && choice.viewport.width === viewport.width && choice.viewport.height === viewport.height))?.id ?? '';

export function ViewportChoices({ tab, room }: { tab: BrowserTab; room: Room }) {
  const current = choiceOf(tab.viewport);
  return (
    <DropdownMenu.RadioGroup value={current}>
      {CHOICES.map(({ id, label, viewport }) => {
        const fitting = viewport === null || fits(viewport, tab.zoom, room);
        return (
          <DropdownMenu.RadioItem
            key={id}
            value={id}
            data-viewport={id}
            disabled={!fitting}
            onSelect={() => {
              if (id !== current) setViewport(tab.tabId, viewport);
            }}
            className={MENU_ITEM}
          >
            <span aria-hidden className="flex w-5 shrink-0 text-accent">
              <DropdownMenu.ItemIndicator>
                <CheckIcon className="size-3.5" />
              </DropdownMenu.ItemIndicator>
            </span>
            <span className="flex-1">{label}</span>
            {viewport !== null && <span className="ml-6 text-ui-sm text-fg-muted">{fitting ? V.size(viewport.width, viewport.height) : V.tooWide}</span>}
          </DropdownMenu.RadioItem>
        );
      })}
    </DropdownMenu.RadioGroup>
  );
}

export function ViewportChip({ tab, room }: { tab: BrowserTab; room: Room }) {
  const box = pageBox(tab.viewport, tab.zoom, room);
  if (box === null) return null;
  const { width, height } = box.reads;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-browser-viewport-chip=""
          aria-label={V.chip(width, height)}
          title={V.chip(width, height)}
          className="h-6 shrink-0 rounded-sm px-1.5 font-mono text-ui-sm text-fg-muted tabular-nums outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active"
        >
          {V.size(width, height)}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          <ViewportChoices tab={tab} room={room} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

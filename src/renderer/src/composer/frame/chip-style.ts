// The frame's shared chip and popover classes (tokens only), so the chip row and the toolbar read as one control set.
export const CHIP =
  'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent data-[state=open]:bg-bg-active';
export const POPOVER = 'z-50 max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg';
export const ITEM =
  'flex w-full cursor-default flex-col items-start rounded-sm px-2 py-1 text-left outline-none select-none hover:bg-bg-hover focus-visible:bg-bg-hover data-highlighted:bg-bg-hover disabled:text-fg-faint disabled:hover:bg-transparent data-disabled:text-fg-faint aria-checked:bg-bg-active';
export const NOTE = 'px-2 py-1 text-ui-sm text-fg-muted';

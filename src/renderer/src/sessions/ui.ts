// The button classes C10's cards and sheets share, tokens only (the same three weights the hover card and the banners
// use: a filled primary, an outlined secondary, a quiet text button).
const BASE = 'rounded-sm px-2.5 py-1 whitespace-nowrap outline-accent focus-visible:outline-2 disabled:cursor-default';
export const PRIMARY = `${BASE} border border-fg bg-fg text-bg hover:bg-fg-muted disabled:border-fg-faint disabled:bg-fg-faint`;
export const DANGER = `${BASE} border border-danger bg-danger text-bg hover:opacity-90 disabled:border-fg-faint disabled:bg-fg-faint`;
export const SECONDARY = `${BASE} border border-border-strong text-fg hover:bg-bg-hover disabled:text-fg-faint`;
export const QUIET = `${BASE} text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint`;
// A native checkbox or radio painted with the accent token rather than the system accent colour.
export const CHOICE = 'accent-accent';
export const FIELD = 'w-full rounded-sm border border-border-strong bg-bg px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2';

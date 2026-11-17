// What a configuration read says beside its rows (UX2-K): reading, a failure with Retry, the files it could not read, and
// the inventory's coverage. Customize's page and, before a chat's first message, its dialogs (UX wave U11a, §D).
// The coverage is a mark on the wire (`CUSTOMIZATION_INVENTORY_COVERAGE`, found by equality and never listed as a failure);
// its words are the window's (UX wave U11h, docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §G): an
// answer with `pluginServers` lists a plugin's connectors, so the note says what it still leaves out; one without (an
// engine host of an earlier build) words it as that host's constant does.
import { CUSTOMIZATION_INVENTORY_COVERAGE, type CustomizationInventory } from '@shared/ipc/schema/customization';

export const INVENTORY_READING = 'Reading configuration…';
export const COVERAGE = {
  now: 'Skills that a marketplace declares but no folder holds, and connectors that a plugin ships as a bundle or in another form MAWS does not read, are not listed; see Plugins.',
  before: CUSTOMIZATION_INVENTORY_COVERAGE,
} as const;
const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';

export function InventoryState({ error, pending, warnings, pluginServers, refresh }: { error: Error | null; pending: boolean; warnings?: string[]; pluginServers?: CustomizationInventory['pluginServers']; refresh(): void }) {
  const failures = warnings?.filter((warning) => warning !== CUSTOMIZATION_INVENTORY_COVERAGE) ?? [];
  return <>
    {pending && <p role="status" className="m-0 p-2 text-ui-sm text-fg-muted">{INVENTORY_READING}</p>}
    {error && <p role="alert" className="m-0 p-2 text-ui-sm text-danger">{error.message} <button type="button" className={BUTTON} onClick={refresh}>Retry</button></p>}
    {failures.length > 0 && <details className="mb-2 px-2 text-ui-sm text-warning"><summary className="rounded-sm outline-accent focus-visible:outline-2">Some configuration could not be read</summary><ul>{failures.map((warning, index) => <li key={index} className="[overflow-wrap:anywhere]">{warning}</li>)}</ul></details>}
    {warnings?.includes(CUSTOMIZATION_INVENTORY_COVERAGE) && <details className="mb-2 px-2 text-ui-sm text-fg-muted"><summary className="rounded-sm outline-accent focus-visible:outline-2">Inventory coverage</summary><p className="my-1 [overflow-wrap:anywhere]">{pluginServers === undefined ? COVERAGE.before : COVERAGE.now}</p></details>}
  </>;
}

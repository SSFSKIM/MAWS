// What a configuration read says beside its rows (UX2-K): reading (the quiet spinner; word cut G203), a failure with
// Retry, and the files it could not read. Customize's page and, before a chat's first message, its dialogs (UX wave
// U11a, §D). The inventory's coverage is a mark on the wire (`CUSTOMIZATION_INVENTORY_COVERAGE`, found by equality and
// never listed as a failure); the folded note U11h drew for it is not drawn (word cut G205, ruled 2026-11-20).
import { CUSTOMIZATION_INVENTORY_COVERAGE } from '@shared/ipc/schema/customization';
import { QuietSpinner } from '../ui/spinner';

export const INVENTORY_READING = 'Reading configuration…';
const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';

export function InventoryState({ error, pending, warnings, refresh }: { error: Error | null; pending: boolean; warnings?: string[]; refresh(): void }) {
  const failures = warnings?.filter((warning) => warning !== CUSTOMIZATION_INVENTORY_COVERAGE) ?? [];
  return <>
    {pending && <QuietSpinner label={INVENTORY_READING} className="m-2" />}
    {error && <p role="alert" className="m-0 p-2 text-ui-sm text-danger">{error.message} <button type="button" className={BUTTON} onClick={refresh}>Retry</button></p>}
    {failures.length > 0 && <details className="mb-2 px-2 text-ui-sm text-warning"><summary className="rounded-sm outline-accent focus-visible:outline-2">Some configuration could not be read</summary><ul>{failures.map((warning, index) => <li key={index} className="[overflow-wrap:anywhere]">{warning}</li>)}</ul></details>}
  </>;
}

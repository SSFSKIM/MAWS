// The Needs-you section (§5.1, §5.7): every session blocked on the human, across projects, longest wait first, one row
// per session (residue *Needs-you ordering and grouping*). Never collapsible; when empty its heading stays with a line
// saying so.
import type { NeedsYouRow as Row } from '../attention/derive';
import { NeedsYouRow } from './NeedsYouRow';
import { SectionHeading } from './SectionHeading';

export function NeedsYou({ rows }: { rows: Row[] }) {
  return (
    <div>
      <SectionHeading title={`Needs you · ${rows.length}`} tone="warning" />
      {rows.length === 0 ? (
        <p className="m-0 px-2.5 py-1.5 text-ui-sm text-fg-faint">Nothing needs you right now</p>
      ) : (
        <ul role="list" aria-label="Needs you" className="m-0 p-0">
          {rows.map((row) => (
            <NeedsYouRow key={row.appSessionId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

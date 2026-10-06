// E2 (M4): what an HTML deliverable's frame logged (Design §8): a chip counting the shown version's errors (its warnings
// when it logged no error), present only while the store's ring buffer holds messages for that version, opening a
// popover that lists each message with its level and line. Shared with the transcript's artifact row (M5), so it reads
// the store by its key alone.
import { Popover } from 'radix-ui';
import type { AppSessionId } from '@shared/graph/ids';
import { DELIVERABLES_COPY } from './copy';
import { consoleKey, useDeliverables, type ConsoleEntry } from './store';

const NONE: ConsoleEntry[] = [];

export function ConsoleChip({ appSessionId, deliverableId, version }: { appSessionId: AppSessionId; deliverableId: string; version: number }) {
  const entries = useDeliverables((s) => s.console.get(consoleKey(appSessionId, deliverableId, version)) ?? NONE);
  if (entries.length === 0) return null;
  const errors = entries.filter((entry) => entry.level === 'error').length;
  const label = errors > 0 ? DELIVERABLES_COPY.consoleErrors(errors) : DELIVERABLES_COPY.consoleWarnings(entries.length);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-console-chip=""
          className={`shrink-0 rounded-full border px-2 py-0.5 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 ${errors > 0 ? 'border-danger text-danger' : 'border-warning text-warning'}`}
        >
          {label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={8} className="z-50 flex max-h-80 w-96 flex-col overflow-auto rounded-md border border-border-strong bg-bg-overlay p-2 text-ui-sm text-fg">
          <ol className="flex flex-col gap-1.5">
            {entries.map((entry, index) => (
              <li key={index} data-console-entry={entry.level} className="flex flex-col gap-0.5 border-b border-border pb-1.5 last:border-b-0 last:pb-0">
                <span className={`font-medium ${entry.level === 'error' ? 'text-danger' : 'text-warning'}`}>
                  {entry.level}
                  {entry.line !== null ? ` · ${DELIVERABLES_COPY.consoleLine(entry.line)}` : ''}
                </span>
                <span className="font-mono break-words whitespace-pre-wrap">{entry.message}</span>
              </li>
            ))}
          </ol>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

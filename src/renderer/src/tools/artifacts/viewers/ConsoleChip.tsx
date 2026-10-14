// E2 (M4): what an HTML page's frame logged (Design §8): a chip counting its errors (its warnings when it logged no
// error), present only while there are any, opening a popover that lists each message with its level and line. P3-L
// (M5b): moved here beside the artifact store's HTML viewer (`artifacts.console`'s); M6b: the transcript's artifact
// row draws it too, for the version its row names (`ArtifactVersionConsoleChip`).
import { Popover } from 'radix-ui';
import { useArtifactConsoleAt } from './console';
import { VIEWERS_COPY } from './copy';

// M6b: the chip of the n-th version of an artifact (the transcript's artifact row's, E2's `ConsoleChip` before it).
export function ArtifactVersionConsoleChip({ artifactId, version }: { artifactId: string; version: number }) {
  return <ConsoleEntriesChip entries={useArtifactConsoleAt(artifactId, version)} />;
}

export interface ConsoleChipEntry {
  level: 'error' | 'warning';
  message: string;
  line: number | null;
}

export function ConsoleEntriesChip({ entries }: { entries: readonly ConsoleChipEntry[] }) {
  if (entries.length === 0) return null;
  const errors = entries.filter((entry) => entry.level === 'error').length;
  const label = errors > 0 ? VIEWERS_COPY.consoleErrors(errors) : VIEWERS_COPY.consoleWarnings(entries.length);
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
                  {entry.line !== null ? ` · ${VIEWERS_COPY.consoleLine(entry.line)}` : ''}
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

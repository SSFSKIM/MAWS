// The stream's small pieces (P5 O8 M7a): a party's name with its machine chip, an entry's time, and its label line
// ("attested at migration by <machine>"; "unverified (from before the move)"). Tokens only.
import { formatClock, formatDateTime } from '@shared/app/date-format';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { MachineChip } from '../app/MachineChip';
import { useMachines } from '../stores/machines';
import { CHANNEL } from './copy';
import type { ChannelEntry, ChannelParty } from './project';

/** The roster's machine a log's machine name names (names compare case-insensitively, as the org's do). */
function useMachineOfName(name: string | null): MachineRef | null {
  return useMachines((s) => {
    if (name === null || name === '') return null;
    const key = name.toLowerCase();
    for (const machine of s.machines.values()) if (machine.name.toLowerCase() === key) return machine.ref;
    return null;
  });
}

/**
 * T1 and T2 for a log's machine name: the roster's chip (`@<name>`, "offline", nothing for this Mac) when the roster
 * names that machine, else the name the log carries, as another machine's.
 */
export function MachineName({ name }: { name: string | null }) {
  const ref = useMachineOfName(name);
  if (ref !== null) return <MachineChip address={addressOf(ref, 'channel')} />;
  if (name === null || name === '') return null;
  return (
    <span data-machine-chip className="shrink-0 truncate text-ui-sm text-fg-muted">
      @{name}
    </span>
  );
}

/** A session as the stream names it: its alias, its title faint beside it, its machine's chip. */
export function Party({ party, title = true }: { party: ChannelParty; title?: boolean }) {
  return (
    <span data-channel-party={party.session} className="inline-flex min-w-0 items-baseline gap-1.5" title={party.title ?? undefined}>
      <span className="truncate font-medium text-fg">{party.alias}</span>
      {title && party.title !== null && <span className="min-w-0 truncate text-fg-muted">{party.title}</span>}
      <MachineName name={party.machine} />
    </span>
  );
}

export function Time({ at }: { at: string | null }) {
  const ms = at === null ? NaN : Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return (
    <time dateTime={at!} title={formatDateTime(ms)} className="ml-auto shrink-0 pl-2 text-ui-sm text-fg-faint tabular-nums">
      {formatClock(ms)}
    </time>
  );
}

/** A legacy entry (DX1, attested by nobody) is drawn faint. */
export const faintOf = (entry: Pick<ChannelEntry, 'label'>): string => (entry.label === 'legacy' ? 'opacity-60' : '');

/** An entry's provenance, said only when it isn't a v2 signature the app checked. */
export function LabelLine({ entry }: { entry: Pick<ChannelEntry, 'label' | 'by'> }) {
  if (entry.label === 'verified') return null;
  return (
    <p data-channel-provenance={entry.label} className="m-0 text-ui-sm text-fg-faint">
      {entry.label === 'migrated' ? CHANNEL.migrated(entry.by ?? '?') : CHANNEL.legacy}
    </p>
  );
}

/** Whom a message went to, beside its sender: "to @a, @b", nothing for everyone. */
export function Recipients({ to }: { to: '*' | readonly { alias: string }[] }) {
  if (to === '*' || to.length === 0) return null;
  return <span className="min-w-0 truncate text-ui-sm text-fg-muted">{`${CHANNEL.to} ${to.map((r) => `@${r.alias}`).join(', ')}`}</span>;
}

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
 * names that machine, else the name the log carries, as another machine's. In a line too narrow for it the chip gives
 * way and truncates, before the alias beside it (`Party`) gives any.
 */
export function MachineName({ name }: { name: string | null }) {
  const ref = useMachineOfName(name);
  if (ref === null && (name === null || name === '')) return null;
  return (
    <span className="inline-flex min-w-0 shrink-[2]">
      {ref !== null ? (
        <MachineChip address={addressOf(ref, 'channel')} className="max-w-full" />
      ) : (
        <span data-machine-chip className="max-w-full truncate text-ui-sm text-fg-muted">
          @{name}
        </span>
      )}
    </span>
  );
}

/**
 * A session as the stream names it: its alias, its title faint beside it, its machine's chip. The alias is drawn whole
 * up to 24 characters and never gives way; the title, then the chip, truncate first.
 */
export function Party({ party, title = true }: { party: ChannelParty; title?: boolean }) {
  return (
    <span data-channel-party={party.session} className="inline-flex min-w-0 items-baseline gap-1.5" title={party.title ?? undefined}>
      <span className="max-w-[24ch] shrink-0 truncate font-medium text-fg">{party.alias}</span>
      {title && party.title !== null && <span className="min-w-0 shrink-[4] truncate text-fg-muted">{party.title}</span>}
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

/**
 * Whom a message went to, beside its sender: "to @a, @b", nothing for everyone. It gives way, but never below 12
 * characters (one short alias whole); the room it keeps past a shorter one is the line's own, before the time.
 */
export function Recipients({ to }: { to: '*' | readonly { alias: string }[] }) {
  if (to === '*' || to.length === 0) return null;
  return <span className="min-w-[12ch] truncate text-ui-sm text-fg-muted">{`${CHANNEL.to} ${to.map((r) => `@${r.alias}`).join(', ')}`}</span>;
}

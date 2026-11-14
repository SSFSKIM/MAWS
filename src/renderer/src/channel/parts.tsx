// The stream's small pieces (P5 O8 M7a): a party's name with its machine chip, an entry's time, and its label line
// ("attested at migration by <machine>"; "unverified (from before the move)"). Tokens only.
import { formatClock, formatDateTime } from '@shared/app/date-format';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { ReactNode } from 'react';
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
 * board 505 (UX wave U11a; the execution document's Interfaces §E, "Names, one order"): how a Channel row's names give way
 * as it narrows, the same in say rows, exchange rows and to-human headers. Each part is sized at its minimum (its width:
 * twelve characters for an alias, nothing for the others) and stops at its whole width (`max-w-max`); the room goes to
 * them by grow weights a thousand apart: the alias first, then the machine chip (up to 24 characters), then the
 * recipients' and owners' labels, then the session's title. Read the other way, as a row narrows the title gives way
 * first, to nothing, then the labels, then the chip, then the alias, never under its twelve. The weights make the order
 * exact in practice (what leaks to the next part is a thousandth) and approximate in principle.
 *
 * A row's names, with the words between them ("and", "to everyone"), are one group (`Names`), which never wraps; the
 * row (`NAMES_ROW`) wraps around it, so a row too narrow for the names' minimums and its fixed parts (the chevron, the
 * count's words, the host's word, the time, which never shrink) moves the fixed parts after the names under them, and
 * the names never split between lines. The group enters its line at the sum of the parts' minimums (`min-w-min`, its
 * min-content: a part's width is also its intrinsic contribution, which a flex basis is not), because `flex-wrap`
 * breaks lines by the items' base sizes, before any of them would shrink.
 */
export const GIVES_WAY = {
  alias: 'min-w-0 w-[12ch] grow-[1000000000] max-w-max truncate',
  chip: 'min-w-0 w-0 grow-[1000000] max-w-max',
  label: 'min-w-0 w-0 grow-[1000] max-w-max truncate',
  title: 'min-w-0 w-0 grow max-w-max truncate',
} as const;
/** A row that holds names: its fixed parts and one `Names` group, wrapping around the group. */
export const NAMES_ROW = 'flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5';

/** A row's names as one item of its row (`GIVES_WAY`): one line, the row's room shared across all of them. */
export function Names({ children }: { children: ReactNode }) {
  return (
    <span data-names="" className="flex min-w-min basis-0 grow items-baseline gap-1.5">
      {children}
    </span>
  );
}
/** The chip inside its part: a block, so its 24 characters bound the part's whole width and it truncates in a narrower part. */
const CHIP = 'block max-w-[24ch]';

/** A party's tooltip: its alias, title and machine in full, joined with " · ", a missing one left out. */
export const partyTooltip = (alias: string, title: string | null, machine: string | null): string => [alias, title, machine].filter((part) => part !== null && part !== '').join(' · ');

/**
 * T1 and T2 for a log's machine name: the roster's chip (`@<name>`, "offline", nothing for this Mac) when the roster
 * names that machine, else the name the log carries, as another machine's. A name part of its row (`GIVES_WAY.chip`).
 */
export function MachineName({ name }: { name: string | null }) {
  const ref = useMachineOfName(name);
  if (ref === null && (name === null || name === '')) return null;
  return (
    <span data-name-part="chip" className={GIVES_WAY.chip}>
      {ref !== null ? (
        <MachineChip address={addressOf(ref, 'channel')} className={CHIP} />
      ) : (
        <span data-machine-chip className={`${CHIP} truncate text-ui-sm text-fg-muted`}>
          @{name}
        </span>
      )}
    </span>
  );
}

/** The chip of a machine the roster or the channel names, as a name part of its row (the to-human header's). */
export function MachineChipPart({ address, name }: { address: string; name?: string }) {
  return (
    <span data-name-part="chip" className={GIVES_WAY.chip}>
      <MachineChip address={address} name={name} className={CHIP} />
    </span>
  );
}

/**
 * A session as the stream names it: its alias, its title faint beside it, its machine's chip, each a name part of the
 * row it sits in (`display: contents`), so they give way in the row's one order among the row's other parts.
 */
export function Party({ party, title = true }: { party: ChannelParty; title?: boolean }) {
  return (
    <span data-channel-party={party.session} className="contents" title={partyTooltip(party.alias, party.title, party.machine)}>
      <span data-name-part="alias" className={`${GIVES_WAY.alias} font-medium text-fg`}>
        {party.alias}
      </span>
      {title && party.title !== null && (
        <span data-name-part="title" className={`${GIVES_WAY.title} text-fg-muted`}>
          {party.title}
        </span>
      )}
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
 * Whom a message went to, beside its sender: "to @a, @b", nothing for everyone. A label of its row (`GIVES_WAY`): it
 * gives way after the title and before the chip, but never below 12 characters (one short alias whole); the room it
 * keeps past a shorter one is the line's own, before the time.
 */
export function Recipients({ to }: { to: '*' | readonly { alias: string }[] }) {
  if (to === '*' || to.length === 0) return null;
  return (
    <span data-name-part="label" className="w-[12ch] min-w-[12ch] grow-[1000] max-w-max truncate text-ui-sm text-fg-muted">
      {`${CHANNEL.to} ${to.map((r) => `@${r.alias}`).join(', ')}`}
    </span>
  );
}

// The library's machine menu (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5, "Which machine an
// artifact is on"; the composer's MachineMenu pattern, composer/frame/MachineMenu.tsx): the Artifacts tab lists one
// machine's library at a time, this Mac by default, or an RL2 machine that is up, by name. An app that reaches no RL2
// machine shows no menu (while another machine's library is shown, the menu stays, to come back by).
import { DropdownMenu } from 'radix-ui';
import type { MachineRef } from '@shared/machine/ref';
import { ChevronDownIcon, Icon } from '../app/IconButton';
import { useMachines } from '../stores/machines';
import { LIBRARY_PAGE as P } from './copy';
import { MENU, MENU_ITEM } from './LibraryHeader';
import { setLibraryView, useLibraryView } from './view';

const LOCAL = 'local'; // the radio value of this Mac (no machine ref is it)

const CheckIcon = () => (
  <Icon className="size-3.5">
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);

// The RL2 machines that are up, by name, in the roster's order.
const useOffered = (): { ref: MachineRef; name: string }[] =>
  [...useMachines((s) => s.machines).values()].filter((m) => !m.local && m.state === 'up' && (m.carrier === 'direct' || m.carrier === 'relay')).map(({ ref, name }) => ({ ref, name }));

export function LibraryMachineMenu() {
  const chosen = useLibraryView((s) => s.machine);
  const offered = useOffered();
  const chosenName = useMachines((s) => (chosen === null ? null : (s.machines.get(chosen)?.name ?? chosen)));
  if (offered.length === 0 && chosen === null) return null;
  // a chosen machine that went down stays in the menu while it is shown
  const items = chosen !== null && !offered.some((m) => m.ref === chosen) ? [...offered, { ref: chosen, name: chosenName ?? chosen }] : offered;
  const label = chosenName ?? P.machine.local;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={P.machine.label(label)}
          title={P.machine.title}
          data-library-machine={chosen ?? LOCAL}
          className="inline-flex h-7 max-w-48 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-ui text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active"
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} aria-label={P.machine.menu} className={MENU}>
          <DropdownMenu.RadioGroup value={chosen ?? LOCAL} onValueChange={(next) => setLibraryView({ machine: next === LOCAL ? null : (next as MachineRef), spaceId: null })}>
            {[{ ref: LOCAL, name: P.machine.local }, ...items].map(({ ref, name }) => (
              <DropdownMenu.RadioItem key={ref} value={ref} className={MENU_ITEM}>
                <span aria-hidden className="flex w-3.5 shrink-0 text-accent">
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="min-w-0 truncate">{name}</span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

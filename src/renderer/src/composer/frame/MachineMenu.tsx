// "+ Session"'s machine menu (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The machine menu",
// A5 and P5 Decision Log 108): beside the project chip of a New chat tab, where its session will run. This Mac by
// default; the menu, asked when it opens, offers each RL2 machine that is up and holds a checkout of the same org project
// (sessions/remote-spawn.ts), by name. Another machine chosen, one line under the row says the session is lane B there
// and runs on that machine's inference route (its route is the machine's settings, which no read of the menu carries),
// and Send starts it there (`session.spawn`). An app that reaches no RL2 machine shows no menu.
// P5 O7 M9 ("Remote setup"): a machine with no checkout of the project is offered too, to set it up there (the sheet,
// RemoteSetupSheet.tsx, chooses the machine once the folder is registered); one whose owners alone could, or that predates
// the setup, is listed greyed with why (sessions/remote-setup.ts).
import { Popover } from 'radix-ui';
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { openDialog } from '../../sessions/dialogs';
import { useRemoteSpawn, useSpawnTarget, type SpawnTarget } from '../../sessions/remote-spawn';
import { readMachines, SETUP_WORDS, suggestionsFor, type MachineChoice } from '../../sessions/remote-setup';
import { useMachines } from '../../stores/machines';
import { CHIP, NOTE, POPOVER } from './chip-style';

export const MACHINE_WORDS = {
  local: 'This Mac',
  title: 'Where this chat runs',
  noProject: 'Choose a project to start it on another machine',
  looking: 'Looking for this project on other machines…',
  none: 'No other machine can start this project', // P5 O7 M9: one without a checkout is offered to set it up
  line: (machine: string) => `Lane B on ${machine} · ${machine}’s inference route`,
} as const;

// Whether this app reaches any machine over RL2 now (the org's other machines; a socket-linked profile is not one).
const useReachesRl2 = (): boolean => useMachines((s) => [...s.machines.values()].some((m) => !m.local && m.state === 'up' && (m.carrier === 'direct' || m.carrier === 'relay')));

const ITEM = 'flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 text-left text-ui outline-none select-none hover:bg-bg-hover focus-visible:bg-bg-hover';

function Item({ label, checked, onSelect }: { label: string; checked: boolean; onSelect(): void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} className={ITEM} onClick={onSelect}>
      <span className="min-w-0 truncate">{label}</span>
      <span aria-hidden className="ml-auto w-3 shrink-0 text-accent">
        {checked ? '✓' : ''}
      </span>
    </button>
  );
}

// P5 O7 M9: a machine to set the project up on (`onSelect`), or one that can't be, its reason in the item itself
function SetupItem({ label, line, onSelect }: { label: string; line: string; onSelect: (() => void) | null }) {
  return (
    <button type="button" role="menuitem" disabled={onSelect === null} className={`${ITEM} h-auto flex-col items-start gap-0 py-1 disabled:hover:bg-transparent`} onClick={onSelect ?? undefined}>
      <span className={`min-w-0 truncate ${onSelect === null ? 'text-fg-muted' : ''}`}>{label}</span>
      <span className="text-ui-sm whitespace-normal text-fg-muted">{line}</span>
    </button>
  );
}

export function MachineMenu({ appSessionId, projectKey, disabled }: { appSessionId: AppSessionId; projectKey: string | null; disabled: string | null }) {
  const reaches = useReachesRl2();
  const chosen = useSpawnTarget(appSessionId, projectKey);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<{ choices: MachineChoice[]; known: string[] } | null>(null); // null while asked
  useEffect(() => {
    if (!open || projectKey === null) return;
    let live = true;
    void readMachines(projectKey).then((found) => live && setCandidates(found));
    return () => {
      live = false;
    };
  }, [open, projectKey]);
  if (!reaches) return null;
  const closed = disabled ?? (projectKey === null ? MACHINE_WORDS.noProject : null);
  const choose = (target: SpawnTarget | null) => {
    useRemoteSpawn.getState().choose(appSessionId, target);
    setOpen(false);
  };
  const setUp = (choice: Extract<MachineChoice, { kind: 'setup' }>) => {
    setOpen(false);
    const { machine, name, key, home, first } = choice;
    openDialog({ kind: 'remoteSetup', request: { kind: 'folder', tab: appSessionId, machine, name, key, home, first, suggestions: suggestionsFor(candidates?.known ?? [], home) } });
  };
  const label = chosen?.name ?? MACHINE_WORDS.local;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setCandidates(null); // asked again at each opening
        setOpen(next);
      }}
    >
      <Popover.Trigger aria-label={`Machine ${label}`} title={closed ?? MACHINE_WORDS.title} disabled={closed !== null} className={`${CHIP} ${chosen ? 'text-fg' : ''}`}>
        <span className="truncate">{label}</span>
        <span aria-hidden className="shrink-0 text-fg-faint">⌄</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Choose a machine" side="top" align="start" sideOffset={6} collisionPadding={8} className={`${POPOVER} w-60`}>
          <div role="menu" aria-label="Machines" className="flex flex-col">
            <Item label={MACHINE_WORDS.local} checked={chosen === null} onSelect={() => choose(null)} />
            {(candidates?.choices ?? []).map((choice) =>
              choice.kind === 'ready' ? (
                <Item key={choice.target.machine} label={choice.target.name} checked={chosen?.machine === choice.target.machine} onSelect={() => choose(choice.target)} />
              ) : choice.kind === 'setup' ? (
                chosen?.machine === choice.machine ? (
                  <Item key={choice.machine} label={choice.name} checked onSelect={() => choose(chosen)} />
                ) : (
                  <SetupItem key={choice.machine} label={choice.name} line={SETUP_WORDS.setUp} onSelect={() => setUp(choice)} />
                )
              ) : (
                <SetupItem key={choice.machine} label={choice.name} line={choice.words} onSelect={null} />
              ),
            )}
          </div>
          {candidates === null && <p className={`${NOTE} m-0`}>{MACHINE_WORDS.looking}</p>}
          {candidates !== null && candidates.choices.length === 0 && <p className={`${NOTE} m-0`}>{MACHINE_WORDS.none}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The line under the project row once another machine is chosen. */
export function MachineLine({ appSessionId, projectKey }: { appSessionId: AppSessionId; projectKey: string | null }) {
  const chosen = useSpawnTarget(appSessionId, projectKey);
  if (chosen === null) return null;
  return <p className="m-0 px-2 pb-1 text-ui-sm text-fg-muted">{MACHINE_WORDS.line(chosen.name)}</p>;
}

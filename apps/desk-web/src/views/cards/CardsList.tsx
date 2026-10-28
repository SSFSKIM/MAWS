// What waits on the machines moved to MAWS (P5 O13 M5): per cut-over machine (the head's entries and the live
// certificates of delegated machines, cards/machines.ts) its name and whether its endpoint is online, and per session of
// the member's waiting on it its listing's title and its pending count as the hub's presence gives it (cards/board.ts).
// An offline machine reads offline and keeps its rows. A session opens its cards (ChannelCards). Machines not moved keep
// their DX6 cards in the project views, and nothing of them is here.
import { useEffect } from 'react';
import type { Me } from '../../hub/me';
import { useDeskLayout } from '../../shell/layout';
import { bootDevice } from '../../cards/boot';
import { useCardsBoard } from '../../cards/board';
import { useDevice } from '../../cards/register';
import { refreshOrg } from '../../cards/start';
import { DeviceStanding } from './DeviceStanding';

const requests = (n: number) => `${n} waiting`;

export function CardsList({ me, onDevice }: { me: Me; onDevice(): void }) {
  useEffect(() => void bootDevice(me), [me]);
  useEffect(() => refreshOrg('cards'), []);
  const { loaded, record } = useDevice();
  const { watching, machines } = useCardsBoard();
  const navigate = useDeskLayout((s) => s.navigate);
  const listed = record?.state.kind === 'listed';
  return (
    <main className="min-h-0 overflow-y-auto p-4" data-testid="cards-list">
      <div className="mx-auto flex max-w-[640px] flex-col gap-4">
        <h1 className="m-0 text-ui font-semibold">Cards</h1>
        {!listed ? (
          <DeviceStanding loaded={loaded} record={record} onDevice={onDevice} />
        ) : !watching ? (
          <p className="m-0 text-ui-sm text-fg-muted" role="status">
            Reading the org's machines…
          </p>
        ) : machines.length === 0 ? (
          <p className="m-0 text-ui-sm text-fg-muted" data-testid="cards-no-machines">
            No machine of the org has moved to MAWS yet: its requests keep their cards in the projects.
          </p>
        ) : (
          machines.map((machine) => (
            <section key={machine.ref} className="flex flex-col gap-1.5" data-cards-machine={machine.ref} aria-label={machine.name}>
              <h2 className="m-0 flex min-w-0 items-baseline gap-2 text-ui-sm">
                <span className="truncate font-semibold text-fg">{machine.name}</span>
                <span className={machine.online === true ? 'text-fg-muted' : 'text-warning'} data-testid="cards-machine-state">
                  {machine.online === true ? 'online' : machine.online === false ? 'offline' : 'connecting…'}
                </span>
              </h2>
              {machine.sessions.length === 0 ? (
                <p className="m-0 text-ui-sm text-fg-faint">Nothing waiting</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {machine.sessions.map((s) => (
                    <li key={s.session}>
                      <button
                        type="button"
                        className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-bg-raised px-3 py-2 text-left text-ui hover:bg-bg-hover"
                        data-cards-session={s.session}
                        data-pending={s.pending}
                        onClick={() => navigate({ view: 'cards', machine: machine.ref, session: s.session })}
                      >
                        <span className="min-w-0 flex-1 truncate">{s.title || s.session.slice(0, 8)}</span>
                        <span className="shrink-0 rounded-sm bg-warning/15 px-1.5 text-ui-sm text-warning">{requests(s.pending)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </main>
  );
}

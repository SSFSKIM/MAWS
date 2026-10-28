// A session's cards on a cut-over machine (P5 O13 M5): the `cards` view of the session over the machine's own sealed
// channel through the hub's relay (M4's `followCards`, a new channel and a fresh snapshot after each drop), each card
// drawn by ChannelCard and answered with the device's passkey. Headed by the session's title and its machine's name.
//
// The device's standing comes first: the view follows a session only while the org state lists this device, and says
// so when it no longer does (a removed device's handshake reads `closed`, which alone would retry for ever). The session
// is named by its verified listing (its lane says which `cards` view to subscribe to); at a landing before the listings
// store's snapshot is in, the session's records are read from the hub into the store (session-listing.ts). A lane B
// session the endpoint will not subscribe to yet (`grade`: no engine session, never prompted locally) is not yet
// actionable, and is followed again when its pending count in the machine's presence moves. No view reads the
// endpoint's `caps` grades as what this phone may do: the endpoint decides each answer.
//
// A push's tap lands here (P5 O13 M6, `/cards/<ref>/<session>`), cold or in a window already open. At each landing (a
// second tap on the same cards reuses this view) and at the view's opening, a machine the org state this phone holds
// does not resolve — a VM certified since the last read, which moved no version and raised no notice — has the state
// read again for it, at most once a minute (org-store.ts's `refresh`, keyed by the ref as a listing's unresolved
// signer is), whatever the view's own read on opening found too recent to repeat.
import { useEffect, useState } from 'react';
import type { Me } from '../../hub/me';
import { useCardsLanding } from '../../pwa/service-worker';
import { useDeskLayout } from '../../shell/layout';
import { useNarrow } from '../../shell/viewport';
import { bootDevice } from '../../cards/boot';
import { useCardsBoard } from '../../cards/board';
import { assertWith } from '../../cards/cards-passkey';
import { channelCardState } from '../../cards/card-state';
import { cardId, type Card } from '../../cards/cards';
import { cardsIdentity, followCards, openChannel, socketFor, type MachineChannel } from '../../cards/client';
import type { DeviceRecord } from '../../cards/device-store';
import { orgView } from '../../cards/org-store';
import { syncOrg, useDevice } from '../../cards/register';
import { fetchListings, followSessionListing, type Looked } from '../../cards/session-listing';
import { deviceOrgStore, listingsStore, refreshOrg } from '../../cards/start';
import { answerCard, attemptKey, newSet, noteCard, retryCard, useAttempts } from './attempts';
import { ChannelCard } from './ChannelCard';
import { DeviceStanding } from './DeviceStanding';

/** The session's verified listing: the store's, at a landing before its snapshot is in taken from the hub's (or none). */
function useSessionListing(machine: string, session: string, loaded: boolean): Looked {
  const [looked, setLooked] = useState<Looked>({ state: 'looking' });
  useEffect(() => {
    const store = listingsStore();
    if (!loaded || store === null) return;
    const read = () => {
      // Read once the phone holds an org state to verify against: the store tells when one comes.
      if (!deviceOrgStore()?.ready) return null;
      const project = socketFor(machine).presence()?.pending[session]?.project ?? null;
      return fetchListings(machine, session, project);
    };
    return followSessionListing(`${machine}/${session}`, store, read, setLooked);
  }, [machine, session, loaded]);
  return looked;
}

export function ChannelCards({ me, machine, session, onDevice }: { me: Me; machine: string; session: string; onDevice(): void }) {
  useEffect(() => void bootDevice(me), [me]);
  useEffect(() => refreshOrg('cards'), []);
  const { loaded, record } = useDevice();
  const listed = record?.state.kind === 'listed';
  const looked = useSessionListing(machine, session, loaded && listed);
  const resolved = useCardsBoard((s) => s.machines.find((m) => m.ref === machine)?.name);
  const watching = useCardsBoard((s) => s.watching);
  const landing = useCardsLanding((s) => (s.landed?.machine === machine && s.landed.session === session ? s.landed.n : 0));
  useEffect(() => {
    if (watching && resolved === undefined) refreshOrg(machine);
  }, [machine, watching, resolved, landing]);
  const name = resolved ?? `${machine.slice(0, 8)}…`;
  const navigate = useDeskLayout((s) => s.navigate);
  const narrow = useNarrow(); // a phone's top bar has the way back
  const title = looked.state === 'found' ? looked.listing.body.fields.title || session.slice(0, 8) : session.slice(0, 8);
  return (
    <main className="min-h-0 overflow-y-auto p-4" data-testid="channel-cards" data-machine={machine} data-session={session}>
      <div className="mx-auto flex max-w-[640px] flex-col gap-3">
        {!narrow && (
          <button type="button" className="self-start rounded-sm px-1 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg" onClick={() => navigate({ view: 'cards' })}>
            ‹ Cards
          </button>
        )}
        <header className="flex min-w-0 flex-col gap-0.5">
          <h1 className="m-0 truncate text-ui font-semibold" data-testid="channel-cards-title">
            {title}
          </h1>
          <p className="m-0 text-ui-sm text-fg-muted" data-testid="channel-cards-machine">
            on {name}
          </p>
        </header>
        {!listed || record === null ? (
          <DeviceStanding loaded={loaded} record={record} onDevice={onDevice} />
        ) : looked.state === 'looking' ? (
          <p className="m-0 text-ui-sm text-fg-muted" role="status">
            Looking up this session…
          </p>
        ) : looked.state === 'none' ? (
          <p className="m-0 text-ui-sm text-fg-muted" data-testid="channel-cards-unlisted">
            This session isn't one of yours on a machine moved to MAWS, or it has ended.
          </p>
        ) : (
          <Following me={me} device={record.deviceId} machine={machine} name={name} session={session} lane={looked.listing.body.fields.lane} title={title} />
        )}
      </div>
    </main>
  );
}

/** Why a subscription ended, in the view's words. */
const ENDED: Record<string, string> = {
  removed: 'This session is no longer yours: its cards are closed here.',
  unavailable: 'The session, or its bridge, is gone: nothing waits here now.',
  grade: 'This session is not yours to answer from this phone.',
  class: 'The machine does not offer these cards to this phone.',
};

type Shown = { id: string; card: Card; present: boolean };

/** The device's record while it is `device`: its keys, which a new head's judgement copies but never changes. */
const recordOf = (device: string): DeviceRecord | null => {
  const { record } = useDevice.getState();
  return record?.deviceId === device ? record : null;
};

function Following({ me, device, machine, name, session, lane, title }: { me: Me; device: string; machine: string; name: string; session: string; lane: 'A' | 'B'; title: string }) {
  const [channel, setChannel] = useState<MachineChannel | null>(null);
  const [shown, setShown] = useState<Shown[] | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const attempts = useAttempts((s) => s.attempts);
  const notes = useAttempts((s) => s.notes);

  useEffect(() => {
    const record = recordOf(device);
    if (record === null) return;
    const identity = cardsIdentity(me.org.id, record);
    const follow = followCards(() => openChannel({ ref: machine }, identity, orgView(), { onBehind: () => void syncOrg() }), { lane, id: session }, {
      cards: (set) => {
        newSet(machine, session);
        setShown((before) => {
          const ids = new Set(set.map(cardId));
          const now: Shown[] = set.map((card) => ({ id: cardId(card), card, present: true }));
          // A card this tab answered that the set no longer carries stays, closed, so the answer's end is seen.
          for (const gone of before ?? []) {
            if (!ids.has(gone.id) && useAttempts.getState().attempts[attemptKey(machine, session, gone.id)] !== undefined) now.push({ ...gone, present: false });
          }
          return now;
        });
      },
      ended: (reason) => {
        setChannel(null);
        setEnded(reason);
      },
      channel: setChannel,
    });
    return () => follow.close();
  }, [me.org.id, device, machine, session, lane, round]);

  // A lane B session not prompted locally yet: followed again once its pending count moves.
  useEffect(() => {
    if (ended !== 'grade' || lane !== 'B') return;
    const socket = socketFor(machine);
    let last = socket.presence()?.pending[session]?.pending;
    return socket.onPresence((presence) => {
      const now = presence?.pending[session]?.pending;
      if (now === last) return;
      last = now;
      setEnded(null);
      setRound((n) => n + 1);
    });
  }, [ended, lane, machine, session]);

  if (ended !== null) {
    const text = ended === 'grade' && lane === 'B' ? "Not yet actionable: this session hasn't been prompted locally yet. Its cards open here once it has." : (ENDED[ended] ?? `The machine ended this phone's channel (${ended}).`);
    return (
      <p className="m-0 text-ui-sm text-warning" role="status" data-testid="channel-cards-ended" data-reason={ended}>
        {text}
      </p>
    );
  }
  if (shown === null) {
    return (
      <p className="m-0 text-ui-sm text-fg-muted" role="status" data-testid="channel-cards-connecting">
        {channel === null ? `Connecting to ${name}…` : 'Reading the cards…'}
      </p>
    );
  }
  const record = recordOf(device);
  if (record === null) return null;
  const assert = assertWith(record);
  const identity = cardsIdentity(me.org.id, record);
  return (
    <div className="flex flex-col gap-3" data-testid="channel-cards-list" data-connected={channel === null ? 'false' : 'true'}>
      {channel === null && (
        <p className="m-0 text-ui-sm text-warning" role="status" data-testid="channel-cards-disconnected">
          Not connected to {name}: reconnecting…
        </p>
      )}
      {shown.length === 0 && <p className="m-0 text-ui-sm text-fg-muted">Nothing waits in this session.</p>}
      {shown.map(({ id, card, present }) => {
        const key = attemptKey(machine, session, id);
        const attempt = attempts[key] ?? null;
        const state = channelCardState({ card: present ? card : null, attempt, connected: channel !== null });
        return (
          <ChannelCard
            key={id}
            card={card}
            state={state}
            attempt={attempt}
            note={notes[key] ?? null}
            where={title}
            machine={name}
            draftId={`cards:${machine}:${session}:${id}`}
            onAnswer={(given) => channel !== null && void answerCard(key, channel, identity, card, given, assert)}
            onRetry={() => channel !== null && void retryCard(key, channel, assert)}
            onNote={(note) => noteCard(key, note)}
          />
        );
      })}
    </div>
  );
}

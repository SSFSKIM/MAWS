// A project's Channel tab (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's "At its end"; Q5):
// the project's one stream across machines, as main verified it, oldest at the top and the composer at the foot, as a
// group chat reads. Under the stream, "Waiting on you": the project's questions and permission cards, answerable here.
//
// While the channel isn't live (the hub unreachable, the sign-in ended, signed out, or still connecting) the tab draws
// what main holds, "As of" the last time it caught up, and the composer is withdrawn; an ended hub sign-in offers "Sign
// in to the hub again", the Org page's own action (`org.signIn`, Q7). "N events didn't verify" counts what main held
// back. The tab holds the channel while mounted (use-channel.ts).
// UX wave U11a M4 (S-09; Interfaces §F, "The footer"): the reason after "As of" is the first that holds of signed out, the
// hub sign-in ended (the channel's own refusal or the org's hub status), the hub no longer admitting the member (the
// same), "Offline · retrying" (the channel's own reach or the hub status), and "Connecting…". The refusal reads before
// reach: a channel the hub ended retries nothing, whatever the org's hub status says. A channel open with nothing held
// and never caught up says this Mac has no copy of it.
// M7b: every machine's to-human entries (ToHumanEntry.tsx) are placed by time among the log's (project.ts), each session
// named from the sessions store; a machine whose MAWS shares none says so, greyed, above the stream.
//
// The selectors the e2e case reads: `data-channel` (the project), `data-channel-entry` (words, say, exchange, host) with
// `data-offset` and `data-channel-label`, `data-word-state`, `data-channel-provenance`, `data-channel-exchange-messages`,
// `data-channel-unverified`, `data-channel-waiting` and `data-channel-card`, `data-channel-composer`, `data-channel-offline`
// with `data-channel-as-of`, and `data-channel-closed`; M7b's `data-channel-entry="to-human"` with `data-host`,
// `data-machine`, `data-key` and `data-greyed`, `data-to-human-question`, `data-to-human-text`, `data-to-human-answer`, and
// `data-channel-unavailable` (the machine's ref).
import { useLayoutEffect, useRef, useState } from 'react';
import { formatDayTime } from '@shared/app/date-format';
import { ipc } from '../ipc/client';
import { useHubAccess, type HubAccess } from '../stores/hub-access';
import { useSessions } from '../stores/sessions';
import { CHANNEL } from './copy';
import { Composer } from './Composer';
import { EntryRow } from './Entries';
import { channelEntries, placeByTime, toHumanEntries, type StreamEntry } from './project';
import { tailOf, type OpenHeld } from './state';
import { ToHumanEntry } from './ToHumanEntry';
import { useChannel } from './use-channel';
import { Waiting } from './Waiting';

const ACTION = 'rounded-sm border border-border-strong px-2.5 py-1 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';
/** How near the bottom (px) still counts as reading the newest, so a new entry keeps the stream at its foot. */
const AT_FOOT_PX = 48;

export function ChannelView({ project }: { project: string }) {
  const channel = useChannel(project);
  const me = useHubAccess((s) => s.member);
  const access = useHubAccess((s) => s.access);
  const records = useSessions((s) => s.records);
  const listed = useSessions((s) => s.listed);
  const { held } = channel;
  const entries: StreamEntry[] =
    held.phase === 'open'
      ? placeByTime(
          channelEntries({ events: held.events, sessions: held.sessions, tail: tailOf(held), me }),
          toHumanEntries({ hosts: held.hosts, machines: held.machines, sessions: held.sessions, records, listed }),
        )
      : [];
  const unavailable = held.phase === 'open' ? held.machines.filter((m) => m.state === 'unavailable') : [];

  // The stream opens at its foot and stays there while the reader is there; a reader scrolled up stays where they are.
  const scroller = useRef<HTMLDivElement>(null);
  const atFoot = useRef(true);
  const onScroll = () => {
    const el = scroller.current;
    if (el !== null) atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < AT_FOOT_PX;
  };
  const newest = entries.at(-1)?.key ?? null;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && atFoot.current) el.scrollTop = el.scrollHeight;
  }, [newest, entries.length]);

  const live = held.phase === 'open' && held.live;
  return (
    <div data-channel={project} className="flex h-full min-h-0 flex-col bg-bg text-ui text-fg">
      {/* board 505: the stream reserves its scrollbar's gutter and the footer the same (styles/app.css), so under classic
          scrollbars the footer's column is the rows'. The footer clips, so 8 px of the stream's foot is the footer's own
          head, where the composer frame's shadow draws. */}
      <div ref={scroller} onScroll={onScroll} role="log" aria-label={CHANNEL.title(null)} className="scroll-gutter min-h-0 flex-1 overflow-y-auto">
        <div className="thread-column flex min-h-full flex-col gap-5 pt-6 pb-2">
          {held.phase === 'opening' && channel.failed === null && <p className="m-0 text-fg-muted">{CHANNEL.opening}</p>}
          {channel.failed !== null && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-danger">
              <span className="min-w-0 break-words" title={channel.failed}>
                {CHANNEL.failed}
              </span>
              <button type="button" className={ACTION} onClick={channel.retry}>
                {CHANNEL.retry}
              </button>
            </div>
          )}
          {held.phase === 'closed' && (
            <p data-channel-closed={held.reason} className="m-0 text-fg-muted">
              {CHANNEL.closed[held.reason]}
            </p>
          )}
          {held.phase === 'open' && held.unverified > 0 && (
            <p data-channel-unverified={held.unverified} className="m-0 text-ui-sm text-fg-faint">
              {CHANNEL.unverified(held.unverified)}
            </p>
          )}
          {unavailable.map((machine) => (
            <p key={machine.machine} data-channel-unavailable={machine.machine} className="m-0 text-ui-sm text-fg-faint">
              {CHANNEL.toHuman.unavailable(machine.name)}
            </p>
          ))}
          {held.phase === 'open' && entries.length === 0 && <p className="m-0 text-fg-muted">{held.asOf === null ? CHANNEL.noCopy : CHANNEL.empty}</p>}
          {entries.map((entry) => (entry.kind === 'to-human' ? <ToHumanEntry key={entry.key} entry={entry} /> : <EntryRow key={entry.key} entry={entry} me={me} />))}
          <div className="mt-auto">
            <Waiting project={project} />
          </div>
        </div>
      </div>
      <div className="scroll-gutter-under shrink-0 pt-2 pb-4">
        <div className="thread-column">
          {live ? <Composer send={channel.send} /> : <Offline reason={offlineReason(me !== null, access, held.phase === 'open' ? held : null)} asOf={held.phase === 'open' ? held.asOf : null} />}
        </div>
      </div>
    </div>
  );
}

type OfflineReason = keyof typeof CHANNEL.offline;

/** §F's footer: the first that holds, from the sign-in, the org's hub status and the channel's own refusal and reach. */
function offlineReason(signedIn: boolean, access: HubAccess | null, channel: Pick<OpenHeld, 'reach' | 'refused'> | null): OfflineReason {
  if (!signedIn || access === null) return 'signedOut';
  if (channel?.refused === 'credentials' || access === 'expired') return 'expired';
  if (channel?.refused === 'removed' || access === 'denied') return 'denied';
  if (channel?.reach === 'unreachable' || access === 'unreachable') return 'unreachable';
  return 'connecting';
}

/** In the composer's place while the channel isn't live: what main holds is as of its last catch-up, and why. */
function Offline({ reason, asOf }: { reason: OfflineReason; asOf: string | null }) {
  const [signing, setSigning] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const at = asOf === null ? NaN : Date.parse(asOf);
  const signIn = async () => {
    setSigning(true);
    setRefused(null);
    const result = await ipc.invoke('org.signIn', undefined);
    setSigning(false);
    if (!result.ok) setRefused(CHANNEL.signInFailed(result.error.message));
    else if (!result.value.ok) setRefused(CHANNEL.signInFailed(result.value.reason.code));
  };
  return (
    <div data-channel-offline className="flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-fg-muted">
        {Number.isFinite(at) && <span data-channel-as-of={asOf}>{CHANNEL.asOf(formatDayTime(at))}</span>}
        {Number.isFinite(at) && <span aria-hidden>·</span>}
        <span>{CHANNEL.offline[reason]}</span>
        {reason === 'expired' && (
          <button type="button" className={ACTION} disabled={signing} onClick={() => void signIn()}>
            {CHANNEL.signInAgain}
          </button>
        )}
      </p>
      {refused !== null && (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {refused}
        </p>
      )}
    </div>
  );
}

// One entry of the stream (P5 O8 M7a; Q5): people's words in a bubble by their member's name (yours read You), a lone
// agent message, an exchange (Exchange.tsx), or an earlier to-human entry from the log with its session's title and
// machine chip. Each says its provenance when it isn't a checked v2 signature (parts.tsx's LabelLine), and a word the
// log doesn't hold yet says where it stands: "sending", a refusal under it, or "Not sent".
import { CHANNEL } from './copy';
import { ExchangeRow } from './Exchange';
import { faintOf, GIVES_WAY, LabelLine, Names, NAMES_ROW, Party, Recipients, Time } from './parts';
import type { ChannelEntry, HostEntry, SayEntry, WordsEntry } from './project';
import { ownersLabel } from '../sidebar/owners';

const BODY = 'm-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]';
const PROSE = `${BODY} text-prose leading-[var(--lh-prose)]`;

export function EntryRow({ entry, me }: { entry: ChannelEntry; me: string | null }) {
  switch (entry.kind) {
    case 'words':
      return <WordsRow entry={entry} />;
    case 'say':
      return <SayRow entry={entry} me={me} />;
    case 'exchange':
      return <ExchangeRow entry={entry} />;
    case 'host':
      return <HostRow entry={entry} />;
  }
}

const stateName = (state: WordsEntry['state']): string | undefined => (state === undefined ? undefined : typeof state === 'string' ? state : 'refused');

function WordsRow({ entry }: { entry: WordsEntry }) {
  const { state } = entry;
  return (
    <article data-channel-entry="words" data-offset={entry.offset ?? undefined} data-channel-label={entry.label} data-word-state={stateName(state)} className={`flex min-w-0 flex-col gap-1 ${faintOf(entry)}`}>
      <header className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
        <span className="truncate font-medium text-fg" title={entry.offset !== null && entry.label === 'verified' ? CHANNEL.signedBy(entry.you ? null : entry.name) : undefined}>
          {entry.name}
        </span>
        <Recipients to={entry.to} />
        {state === 'sending' ? <span className="ml-auto shrink-0 pl-2 text-fg-faint">{CHANNEL.sending}</span> : <Time at={entry.at} />}
      </header>
      <p className={`${PROSE} self-start rounded-lg bg-(--bg-user-message) px-3 py-1.5 ${state === 'not-sent' || typeof state === 'object' ? 'text-fg-muted' : 'text-fg'}`}>{entry.text}</p>
      {state === 'not-sent' && (
        <p role="status" className="m-0 text-ui-sm text-danger">
          {CHANNEL.notSent}
        </p>
      )}
      {typeof state === 'object' && (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {CHANNEL.refused(state.refused)}
        </p>
      )}
      <LabelLine entry={entry} />
    </article>
  );
}

function SayRow({ entry, me }: { entry: SayEntry; me: string | null }) {
  const owners = ownersLabel(
    entry.owners.map((o) => o.id),
    me,
    new Map(entry.owners.map((o) => [o.id, o])),
  );
  return (
    <article data-channel-entry="say" data-offset={entry.offset} data-channel-label={entry.label} className={`flex min-w-0 flex-col gap-1 ${faintOf(entry)}`}>
      <header className={`${NAMES_ROW} text-ui-sm`}>
        <Names>
          <Party party={entry.from} />
          {entry.to === '*' ? <span className="shrink-0 text-fg-muted">{CHANNEL.toEveryone}</span> : <Recipients to={entry.to} />}
          {owners !== null && (
            <span data-name-part="label" className={`${GIVES_WAY.label} text-fg-faint`}>
              {owners}
            </span>
          )}
        </Names>
        <Time at={entry.at} />
      </header>
      <p className={`${BODY} text-ui text-fg`}>{entry.text}</p>
      <LabelLine entry={entry} />
    </article>
  );
}

function HostRow({ entry }: { entry: HostEntry }) {
  return (
    <article data-channel-entry="host" data-host={entry.host} data-offset={entry.offset} data-channel-label={entry.label} className={`flex min-w-0 flex-col gap-1 ${faintOf(entry)}`}>
      <header className={`${NAMES_ROW} text-ui-sm`}>
        <Names>
          <Party party={entry.party} />
        </Names>
        <span className="shrink-0 text-fg-muted">{CHANNEL.host[entry.host]}</span>
        <Time at={entry.at} />
      </header>
      <p className={`${PROSE} text-fg`}>{entry.text}</p>
      {entry.choices !== undefined && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {entry.choices.map((choice) => (
            <li key={choice} className="rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted">
              {choice}
            </li>
          ))}
        </ul>
      )}
      <LabelLine entry={entry} />
    </article>
  );
}

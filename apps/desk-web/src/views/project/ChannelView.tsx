// The center column: the selected channel, drawn only from verified log events. M1 draws them plainly — who wrote
// what, and lifecycle as system lines; the conversation's own rendering (folding, questions answered in place, request
// cards, the composer) is M3's.
import type { LogEvent } from 'desk-hub/protocol';
import type { Channel } from '../../shell/layout';
import type { DeskSession } from '../../shell/sessions';

type Row = { offset: number; kind: 'said' | 'system'; who: string; text: string; ts: string };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const addressed = (event: LogEvent, session: string) => Array.isArray(event.to) && event.to.some((r) => typeof r === 'object' && r !== null && (r as { session?: unknown }).session === session);
const writerSession = (writer: string) => writer.slice(writer.indexOf('/') + 1);

function rowOf(offset: number, event: LogEvent, sessions: Map<string, DeskSession>): Row | null {
  const alias = (id: unknown) => (typeof id === 'string' ? (sessions.get(id)?.alias ?? id.slice(0, 8)) : '');
  switch (event.kind) {
    case 'human':
      return { offset, kind: 'said', who: 'You', text: str(event.text), ts: event.ts };
    case 'say':
    case 'message':
    case 'question':
    case 'answered':
      return { offset, kind: 'said', who: str(event.from), text: str(event.text), ts: event.ts };
    case 'joined':
      return { offset, kind: 'system', who: '', text: `${alias(event.session)} joined on ${str(event.machine)}`, ts: event.ts };
    case 'retired':
      return { offset, kind: 'system', who: '', text: `${alias(event.session)} retired${str(event.by) ? ` by ${str(event.by)}` : ''}`, ts: event.ts };
    case 'renamed':
      return { offset, kind: 'system', who: '', text: `${alias(event.session)} is now ${str(event.alias)}`, ts: event.ts };
    case 'in-charge':
      return { offset, kind: 'system', who: '', text: `${alias(event.session)} is in charge of: ${str(event.text)}`, ts: event.ts };
    default:
      return null;
  }
}

function inChannel(event: LogEvent, channel: Channel): boolean {
  if (channel.kind === 'group') return true;
  if (event.kind === 'human' || event.kind === 'say') return addressed(event, channel.session);
  if (event.kind === 'message' || event.kind === 'question' || event.kind === 'answered') return writerSession(event.writer) === channel.session;
  return false;
}

const time = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function ChannelView(props: { name: string; channel: Channel; session: DeskSession | null; events: Array<{ offset: number; event: LogEvent }>; sessions: Map<string, DeskSession> }) {
  const { name, channel, session, events, sessions } = props;
  const rows = events.filter((e) => inChannel(e.event, channel)).flatMap((e) => rowOf(e.offset, e.event, sessions) ?? []);
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-bg" aria-label="Channel">
      <header className="flex h-[44px] shrink-0 items-center gap-2 border-b border-border px-4" data-testid="channel-header">
        {channel.kind === 'group' ? (
          <span className="text-ui font-semibold">
            <span className="text-fg-muted">#</span> {name}
          </span>
        ) : (
          <>
            <span className="text-ui font-semibold">{session?.alias ?? channel.session.slice(0, 8)}</span>
            {session && <span className="text-ui-sm text-fg-muted">@{session.machine}</span>}
            {session?.charge && <span className="truncate text-ui-sm text-fg-muted">· {session.charge}</span>}
          </>
        )}
      </header>
      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-4 py-3" data-testid="channel-events">
        {rows.length === 0 && <li className="text-ui-sm text-fg-muted">Nothing here yet.</li>}
        {rows.map((row) =>
          row.kind === 'system' ? (
            <li key={row.offset} className="py-1 text-ui-sm text-fg-muted" data-offset={row.offset}>
              {row.text}
            </li>
          ) : (
            <li key={row.offset} className="py-1.5" data-offset={row.offset}>
              <div className="flex items-baseline gap-2">
                <span className="text-ui font-semibold">{row.who}</span>
                <span className="text-ui-sm text-fg-faint">{time(row.ts)}</span>
              </div>
              <p className="m-0 font-prose text-prose leading-[var(--lh-prose)] whitespace-pre-wrap">{row.text}</p>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

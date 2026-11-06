// The project channel's stream as the tab draws it (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// M7a's "At its end", *Folding* and *The waiting cards*; Interfaces §N, with the pre-flight's ruling that main sends its
// verified events and this pure projection folds them into §N's `ChannelEntry`, a renderer type).
//
// What draws, oldest first by offset:
// - people's words (`human`): by their member as main named them (`author`), you as You;
// - agent-to-agent traffic (`say`), folded: a run of says between the same two sessions (writer and its one recipient),
//   each within ten minutes of the last (either way: the order is the log's), is one exchange; an audience stream's
//   writer is its session's (main names the session, `ChannelEvent.session`); a session's broadcasts (`to: '*'`) in the window fold as
//   messages to everyone; a third session's say, a gap, or any other drawn entry ends a run, and a run of one draws as
//   the message itself. A run holds events of one label only, so every entry carries exactly one;
// - earlier to-human entries in the log (a pre-cutover machine's `message`, `question` and `answered`);
// - after the log, the words the log doesn't hold yet (`tail`: main's pending words, and this renderer's that left them).
// Everything else draws nothing: lifecycle events (they give the parties their aliases, titles and machines, through
// main's `sessions`), states, statuses, `unlisted` notices. Main sends no tombstone and no event that failed.
//
// A session whose lifecycle is only `legacy` (main's `authenticated: false`: a phase-1 code nothing checks) names only
// `legacy` entries. A verified or migrated entry of it draws as a session the lifecycle doesn't name: its event's own
// alias and its writer's machine, so unchecked names never stand on a checked entry.
//
// `waitingFor` is the "Waiting on you" section's filter: the open requests of the sessions the sidebar files under this
// org project, this Mac's and other machines' (`rowOfSession`, `rowOfListed`), a greyed machine's left out (nothing
// there can be answered now).
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { ChannelEvent, ChannelRecipients, ChannelSession, ChannelWord, OrgMember } from '@shared/ipc/schema/org';
import { waitsOnAnswer } from '@shared/attention/kinds';
import { rowOfListed, rowOfListedRecord, rowOfSession, type OrgIndex, type RowKey } from '../stores/org-projects';
import type { ListedSession } from '../stores/sessions';
import { CHANNEL } from './copy';

export type ChannelLabel = ChannelEvent['label'];
export type ChannelParty = { session: string; alias: string; title: string | null; machine: string | null };
/** `verified` (a v2 signature main checked), `migrated` (a DX1 event a machine attested at the move; `by` names it) or `legacy`. */
type Labelled = { key: string; label: ChannelLabel; by?: string };
/** A word's state while the log doesn't hold it, main's: `sending`, acknowledged and not yet logged (`sent`), let go unacknowledged (`not-sent`), or refused. */
export type WordState = ChannelWord['state'];
export type WordsEntry = Labelled & {
  kind: 'words';
  offset: number | null; // null for a word not in the log yet
  member: string | null;
  name: string;
  you: boolean;
  to: ChannelRecipients;
  text: string;
  at: string | null;
  state?: WordState;
};
export type SayEntry = Labelled & { kind: 'say'; offset: number; from: ChannelParty; to: '*' | ChannelParty[]; text: string; at: string; owners: OrgMember[] };
export type ExchangeEntry = Labelled & {
  kind: 'exchange';
  offsets: number[];
  between: [ChannelParty, ChannelParty] | [ChannelParty, 'everyone'];
  count: number;
  first: string;
  last: string;
  says: SayEntry[];
};
export type HostEntry = Labelled & { kind: 'host'; offset: number; party: ChannelParty; host: 'message' | 'question' | 'answered'; text: string; choices?: string[]; at: string };
export type ChannelEntry = WordsEntry | SayEntry | ExchangeEntry | HostEntry;

/** A word after the log: main's pending, the signed-in member's own. */
export type TailWord = { key: string; text: string; to: ChannelRecipients; state: WordState };

export const EXCHANGE_WINDOW_MS = 10 * 60_000;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
/** sminos records an ask's questions as a list; an older event carries one text. Drawn a paragraph each. */
const questionText = (value: unknown): string => (Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [str(value)]).join('\n\n');
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []);
const recipients = (to: unknown): { session: string; alias: string }[] =>
  Array.isArray(to) ? to.flatMap((r) => (typeof r === 'object' && r !== null && typeof (r as { session?: unknown }).session === 'string' ? [{ session: (r as { session: string }).session, alias: str((r as { alias?: unknown }).alias) }] : [])) : [];
/** The machine a session's writer names (`<machine>/<session>`); none for `hub/` and `legacy/`. */
const writerMachine = (writer: string): string | null => (writer.startsWith('hub/') || writer.startsWith('legacy/') || writer.indexOf('/') <= 0 ? null : writer.slice(0, writer.indexOf('/')));
/** The session an event's writer is, as main read it (`session`: a machine writer, its audience stream included). */
const sessionOf = (e: ChannelEvent): string => e.session ?? e.writer;
const labelOf = (e: ChannelEvent): Pick<Labelled, 'label' | 'by'> => (e.by === undefined ? { label: e.label } : { label: e.label, by: e.by });

export function channelEntries(input: { events: readonly ChannelEvent[]; sessions: readonly ChannelSession[]; tail: readonly TailWord[]; me: string | null }): ChannelEntry[] {
  const known = new Map(input.sessions.map((s) => [s.session, s]));
  /** `session` as an entry labelled `label` may name it: by its lifecycle, a legacy one for a legacy entry alone. */
  const party = (session: string, label: ChannelLabel, fallback: { alias?: string; writer?: string } = {}): ChannelParty => {
    const lifecycle = known.get(session);
    const s = lifecycle !== undefined && (lifecycle.authenticated || label === 'legacy') ? lifecycle : undefined;
    return {
      session,
      alias: s?.alias || fallback.alias || session.slice(0, 8),
      title: s?.title ?? null,
      machine: s?.machine || (fallback.writer === undefined ? null : writerMachine(fallback.writer)),
    };
  };
  const entries: ChannelEntry[] = [];
  let run: { fold: string; label: string; says: SayEntry[] } | null = null;
  const flush = () => {
    if (run === null) return;
    const { says } = run;
    run = null;
    if (says.length === 1) return void entries.push(says[0]);
    const [first] = says;
    const other = first.to === '*' ? 'everyone' : (says.find((s) => s.from.session !== first.from.session)?.from ?? (first.to as ChannelParty[])[0]);
    entries.push({
      kind: 'exchange',
      key: `x:${first.offset}`,
      label: first.label,
      ...(first.by === undefined ? {} : { by: first.by }),
      offsets: says.map((s) => s.offset),
      between: other === 'everyone' ? [first.from, 'everyone'] : [first.from, other],
      count: says.length,
      first: first.at,
      last: says[says.length - 1].at,
      says,
    });
  };

  for (const e of [...input.events].sort((a, b) => a.offset - b.offset)) {
    const { event } = e;
    const at = str(event.ts);
    switch (event.kind) {
      case 'say': {
        const from = party(sessionOf(e), e.label, { alias: str(event.from), writer: e.writer });
        const to = event.to === '*' ? ('*' as const) : recipients(event.to).map((r) => party(r.session, e.label, { alias: r.alias }));
        const entry: SayEntry = { kind: 'say', key: `s:${e.offset}`, ...labelOf(e), offset: e.offset, from, to, text: str(event.text), at, owners: e.owners ?? [] };
        // the run this say may join: its two sessions, or its session's broadcasts; a say to several folds with none
        const fold = to === '*' ? `*:${from.session}` : to.length === 1 && to[0].session !== from.session ? `2:${[from.session, to[0].session].sort().join(':')}` : null;
        const label = `${entry.label}:${entry.by ?? ''}`;
        const last = run?.says[run.says.length - 1];
        const near = last !== undefined && Math.abs(Date.parse(at) - Date.parse(last.at)) <= EXCHANGE_WINDOW_MS; // NaN: never near
        if (run !== null && fold !== null && run.fold === fold && run.label === label && near) {
          run.says.push(entry);
          break;
        }
        flush();
        if (fold === null) entries.push(entry);
        else run = { fold, label, says: [entry] };
        break;
      }
      case 'human': {
        flush();
        const member = str(event.member) || null;
        const you = member !== null && member === input.me;
        const name = you ? CHANNEL.you : (e.author?.name ?? (member === null ? CHANNEL.nobody : CHANNEL.someone(member)));
        const to: ChannelRecipients = event.to === '*' ? '*' : recipients(event.to);
        entries.push({ kind: 'words', key: `w:${e.offset}`, ...labelOf(e), offset: e.offset, member, name, you, to, text: str(event.text), at });
        break;
      }
      case 'message':
      case 'question':
      case 'answered': {
        flush();
        const host = event.kind;
        const choices = host === 'question' ? strings(event.choices) : [];
        entries.push({
          kind: 'host',
          key: `h:${e.offset}`,
          ...labelOf(e),
          offset: e.offset,
          party: party(sessionOf(e), e.label, { alias: str(event.from), writer: e.writer }),
          host,
          text: host === 'question' ? questionText(event.text) : str(event.text),
          ...(choices.length > 0 ? { choices } : {}),
          at,
        });
        break;
      }
      default:
        break; // lifecycle, states, statuses, notices: nothing drawn, and no run ended
    }
  }
  flush();
  for (const word of input.tail) {
    entries.push({ kind: 'words', key: `t:${word.key}`, label: 'verified', offset: null, member: input.me, name: CHANNEL.you, you: true, to: word.to, text: word.text, at: null, state: word.state });
  }
  return entries;
}

/** The sidebar rows that stand for the org project with this sminos id. */
const rowsOf = (index: OrgIndex, project: string): Set<RowKey> => new Set([...index.orgs.values()].filter((o) => o.smnsId === project).map((o) => o.id));

/** The org project's name, as its row reads; null while no project names this id. */
export function channelProjectName(index: OrgIndex, project: string): string | null {
  return [...index.orgs.values()].find((o) => o.smnsId === project)?.name ?? null;
}

export function waitingFor(input: {
  project: string;
  index: OrgIndex;
  projects: ReadonlyMap<ProjectId, ProjectRecord>;
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  listed: ReadonlyMap<AppSessionId, ListedSession>;
  bySession: ReadonlyMap<AppSessionId, AttentionItem[]>;
  greyed: ReadonlySet<AppSessionId>;
}): AttentionItem[] {
  const rows = rowsOf(input.index, input.project);
  if (rows.size === 0) return [];
  const rowOf = (appSessionId: AppSessionId): RowKey | null => {
    const record = input.records.get(appSessionId);
    if (record !== undefined) {
      const filed = rowOfListedRecord(input.index, input.projects, record, input.listed);
      return filed === undefined ? rowOfSession(input.index, input.projects, record) : filed;
    }
    const listing = input.listed.get(appSessionId);
    return listing === undefined ? null : rowOfListed(input.index, listing);
  };
  const out: AttentionItem[] = [];
  for (const [appSessionId, items] of input.bySession) {
    if (input.greyed.has(appSessionId)) continue;
    const row = rowOf(appSessionId);
    if (row === null || !rows.has(row)) continue;
    out.push(...items.filter(waitsOnAnswer));
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

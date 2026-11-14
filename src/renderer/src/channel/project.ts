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
// M7b (Interfaces §O; M7b's Renderer bullet): every machine's to-human entries (main's `hosts`), as `toHumanEntries` draws
// them, `placeByTime` among the log's:
// - each names its session as the sidebar does: a lane A session by its lifecycle's alias and title (an authenticated
//   one), else its listing's title; a lane B one by this Mac's record or another machine's listing; and its machine;
// - a message as it was sent; a question with its choices and its answer, which joins it by its `src` on the same
//   machine (an ask's `…/ask/<askId>/<question>/answered`, a need-input's `…/answer/<message>/<block>/<span>/<at>`, the
//   latest standing), so it isn't drawn again on its own; an answer whose question isn't held (lane A's, which sminos
//   records apart, or one past the bound) stands alone;
// - one ask's questions, said at once, are one entry, in the order main keeps them (its journal's), grouped by their
//   `ask/<askId>/` src prefix; each question carries its text and choices, which is all the person needs to follow it;
// - an entry of a machine that isn't live is "as of" the machine's time (offline, or an older one read once); one of a
//   machine that answers neither (`unavailable`) is greyed.
// Placement is by time: each goes before the first log entry said after it, the words the log doesn't hold yet last.
//
// `waitingFor` is the "Waiting on you" section's filter: the open requests of the sessions the sidebar files under this
// org project, this Mac's and other machines' (`rowOfRecord`, `rowOfListed`), a greyed machine's left out (nothing
// there can be answered now).
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { ChannelEvent, ChannelHost, ChannelMachine, ChannelRecipients, ChannelSession, ChannelWord, OrgMember } from '@shared/ipc/schema/org';
import { waitsOnAnswer } from '@shared/attention/kinds';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { displayTitle, listedTitle } from '../sessions/title';
import { rowOfListed, rowOfRecord, type OrgIndex, type RowKey } from '../stores/org-projects';
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

/** M7b: one question of a to-human entry, with its answer once it has one. */
export type ToHumanQuestion = { key: string; text: string; choices: string[]; answer: { text: string; at: string } | null };
/**
 * M7b: a session's to-human entry from its machine's spine: `name` its alias (lane A) or title (lane B), `title` a lane A
 * session's title beside its alias; `machineName` the machine's name as the channel's machines say it (null for one they
 * don't hold), which its chip says when the roster doesn't name the machine (its cached entries, signed out); `asOf` its
 * machine's time while that machine isn't live; `greyed` while the machine answers neither the feed nor the history call.
 */
export type ToHumanEntry = { kind: 'to-human'; key: string; machine: MachineRef; machineName: string | null; name: string; title: string | null; at: string; asOf: string | null; greyed: boolean } & (
  | { host: 'message' | 'answered'; text: string }
  | { host: 'question'; questions: ToHumanQuestion[] }
);
/** What the stream draws: the log's entries and the machines' to-human entries, placed by time. */
export type StreamEntry = ChannelEntry | ToHumanEntry;

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

/**
 * UX wave U11a M5 (S-10; Interfaces §F, "The Channel's entries"): the channel of the sidebar row `row`, the sminos id of
 * its org project, or null where it has none. One rule for both of the sidebar's menus, which offer Channel on a project
 * row whose org project has an id the registry does not keep off the hub, and on a registry row whose project is the
 * hub's (`sidebar/menus.tsx`; has-channel.test.tsx holds them equal). A machine's own row, and a key no row has, has none.
 */
export function channelOfRow(row: RowKey, index: OrgIndex): string | null {
  const org = index.orgs.get(row);
  if (org === undefined || org.registry?.hub === false) return null;
  return org.smnsId;
}

/** Every project of a row the sidebar lists that has a channel, once, named as its row reads, in name order. */
export function channelProjects(index: OrgIndex): { project: string; name: string }[] {
  const rows = [...index.listed].flatMap((key) => {
    const project = channelOfRow(key, index);
    return project === null ? [] : [{ project, name: index.orgs.get(key)!.name }];
  });
  rows.sort((a, b) => a.name.localeCompare(b.name) || (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
  const once = new Map<string, { project: string; name: string }>();
  for (const row of rows) if (!once.has(row.project)) once.set(row.project, row);
  return [...once.values()];
}

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
    if (record !== undefined) return rowOfRecord(input.index, input.projects, record, input.listed);
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

/** The parts of a lane B `src` (`<project>/lane-b/<appSessionId>/<anchor…>`, each part encoded); null for any other. */
const laneBParts = (src: string): string[] | null => {
  const parts = src.split('/');
  return parts.length >= 4 && parts[1] === 'lane-b' ? parts : null;
};
/** The `src` of the question an answer answers, on its machine; null when its src names none. */
function questionOf(src: string): string | null {
  const parts = laneBParts(src);
  if (parts === null) return null;
  const [kind, ...anchor] = parts.slice(3);
  if (kind === 'ask' && anchor.length === 3 && anchor[2] === 'answered') return [...parts.slice(0, 3), 'ask', anchor[0], anchor[1]].join('/');
  if (kind === 'answer' && anchor.length === 4) return [...parts.slice(0, 3), 'text', ...anchor.slice(0, 3)].join('/');
  return null;
}
/** The ask a question was asked in (`…/ask/<askId>`), which groups its questions; null for any other question. */
function askOf(src: string): string | null {
  const parts = laneBParts(src);
  return parts !== null && parts[3] === 'ask' && parts.length === 6 ? parts.slice(0, 5).join('/') : null;
}

/** A session as the sidebar names it: lane A by its authenticated lifecycle, else its listing; lane B by its record or listing. */
function sessionName(host: ChannelHost, names: { sessions: ReadonlyMap<string, ChannelSession>; records: ReadonlyMap<AppSessionId, SessionRecord>; listed: ReadonlyMap<AppSessionId, ListedSession> }): { name: string; title: string | null } {
  const id = host.session;
  if (id === null || id === '') return { name: CHANNEL.nobody, title: null };
  const address = addressOf(host.machine, id as AppSessionId);
  if (host.lane === 'A') {
    const lifecycle = names.sessions.get(id);
    if (lifecycle?.authenticated) return { name: lifecycle.alias || id.slice(0, 8), title: lifecycle.title };
  } else {
    const record = names.records.get(address);
    if (record !== undefined) return { name: displayTitle(record), title: null };
  }
  const listing = names.listed.get(address);
  return { name: listing === undefined ? id.slice(0, 8) : listedTitle(listing), title: null };
}

export function toHumanEntries(input: {
  hosts: readonly ChannelHost[];
  machines: readonly ChannelMachine[];
  sessions: readonly ChannelSession[];
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  listed: ReadonlyMap<AppSessionId, ListedSession>;
}): ToHumanEntry[] {
  const names = { sessions: new Map(input.sessions.map((s) => [s.session, s])), records: input.records, listed: input.listed };
  const machines = new Map(input.machines.map((m) => [m.machine, m]));
  const onMachine = (host: ChannelHost, src: string) => `${host.machine} ${src}`;
  // each question by its machine and src, and the latest answer to it there
  const asked = new Set(input.hosts.filter((h) => h.kind === 'question').map((h) => onMachine(h, h.src)));
  const answers = new Map<string, { text: string; at: string }>();
  const paired = new Set<string>();
  for (const host of input.hosts) {
    if (host.kind !== 'answered') continue;
    const question = questionOf(host.src);
    if (question === null || !asked.has(onMachine(host, question))) continue;
    paired.add(host.key);
    const key = onMachine(host, question);
    const held = answers.get(key);
    if (held === undefined || Date.parse(host.at) >= Date.parse(held.at)) answers.set(key, { text: host.text, at: host.at });
  }
  const out: ToHumanEntry[] = [];
  const asks = new Map<string, Extract<ToHumanEntry, { host: 'question' }>>();
  for (const host of input.hosts) {
    if (paired.has(host.key)) continue;
    const machine = machines.get(host.machine);
    const base = {
      kind: 'to-human' as const,
      key: host.key,
      machine: host.machine,
      machineName: machine?.name ?? null,
      ...sessionName(host, names),
      at: host.at,
      asOf: machine === undefined || machine.state === 'live' ? null : machine.asOf,
      greyed: machine?.state === 'unavailable',
    };
    if (host.kind !== 'question') {
      out.push({ ...base, host: host.kind, text: host.text });
      continue;
    }
    const question: ToHumanQuestion = { key: host.key, text: host.text, choices: host.choices ?? [], answer: answers.get(onMachine(host, host.src)) ?? null };
    const ask = askOf(host.src);
    const group = ask === null ? undefined : asks.get(onMachine(host, ask));
    if (group !== undefined) {
      group.questions.push(question);
      continue;
    }
    const entry: Extract<ToHumanEntry, { host: 'question' }> = { ...base, host: 'question', questions: [question] };
    if (ask !== null) asks.set(onMachine(host, ask), entry);
    out.push(entry);
  }
  return out;
}

/** When a log entry was said, for placing by time; null for a word the log doesn't hold yet, or a time that doesn't read. */
function saidAt(entry: ChannelEntry): number | null {
  const at = entry.kind === 'exchange' ? entry.first : entry.at;
  const ms = at === null ? NaN : Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/** The to-human entries (by time) among the log's: each before the first log entry said after it; the unlogged words last. */
export function placeByTime(log: readonly ChannelEntry[], toHuman: readonly ToHumanEntry[]): StreamEntry[] {
  const out: StreamEntry[] = [];
  let next = 0;
  /** The to-human entries said before `at` (all of them for null), placed. */
  const placeBefore = (at: number | null) => {
    while (next < toHuman.length && (at === null || (Date.parse(toHuman[next].at) || 0) < at)) {
      out.push(toHuman[next]);
      next += 1;
    }
  };
  for (const entry of log) {
    if (entry.kind === 'words' && entry.offset === null) placeBefore(null);
    else {
      const at = saidAt(entry);
      if (at !== null) placeBefore(at);
    }
    out.push(entry);
  }
  placeBefore(null);
  return out;
}

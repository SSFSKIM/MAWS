// One reading of every arrival (UX wave U3, UC-2; docs/doperpowers/specs/2026-11-12-ux-wave/U3-transcript-rows.md,
// Contracts, and its execution document docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, Interfaces A). What
// enters a session from elsewhere, read off the frame or row that carried it (its carrier) as the engine wrote it: a
// message from a peer or a subagent, a background task's notification, a scheduled prompt's firing, an answer to a
// question asked without waiting, a slash command's output, the person's own words sminos delivered, the bridge's wake,
// and MAWS's own consent message. The three places that turn the engine's frames and rows into X1 events (the live
// normaliser, the transcript-file backfill, the reader of another machine's rows) ask this module, so a class becomes
// the same events on every route. Pure: it imports nothing from the renderer or the engine host.
//
// The rules of reading (UC-2): (1) marks first, text second: a class is given only where the carrier's own marks allow
// it (its origin object, its envelope tag, its attachment type, `local_command_source`, the fields the engine writes for
// a scheduled fire), and the person's typed prompt is never an arrival, but for MAWS's own two texts (its answer
// envelope, read whole, and its consent message, read whole or, in a text the engine may have joined, line by line, and,
// where a sminos bridge carried it for the person to a terminal session (submitted as the user, or appended into the
// running turn as another machine's rows draw it), read whole: UX wave U1c) and a background
// session's prompt that opens with a whole sminos frame line (decision 19); (2) sminos's
// frame line says whose a delivered row is: `human` is the person (`own`), any other sender a peer; (3) one carrier can
// hold several arrivals; (4) what no class claims is left alone; (5) an arrival with two carriers is read once
// (`readNext`); (6) a notification block's outcome is its `<status>`, and none without one.
import { PASTED_BLOCK } from '../composer/pasted-content';
import { askSteerOpening, parseAskSteer } from '../maws/ask';
import { stripAnsi } from '../wire/ansi';
import type { ContentBlock } from '../graph/events';
import type { Arrival, CommandFacts } from './arrival-schema';
import { askAnswers, DISMISSED } from './ask-delivery';
import { INTERRUPT_MARKER, localCommandParts } from './engine-markers';
import { GRANT_OPENING } from './grant';
import { handbackReport, messageText, parsePeerMessage, peerEventsOf, sminosFrameAlias, sminosFrameOwners, sminosFrameSender, sminosParts } from './peer-envelope';
import { BRIDGE_PLUGINS, BRIDGE_WAKE_LINE, deliveredPrompts, deliveredText, firstLine, isBridgeWake, markedSteerWords, STEER_LINE } from './sminos-delivery';
import { notificationText, taskNotificationBlocks } from './task-notification';

export { ArrivalEntrySchema, CarriedArrivalSchema, carriedOf, commandEntry, commandOf, type Arrival, type ArrivalEntry, type CarriedArrival, type CommandFacts } from './arrival-schema';

type Json = Record<string, unknown>;
type Answer = Extract<Arrival, { class: 'answer' }>;
type Task = Extract<Arrival, { class: 'task' }>;
type Own = Extract<Arrival, { class: 'own' }>;
type Peer = Extract<Arrival, { class: 'peer' }>;
type Command = Extract<Arrival, { class: 'command' }>;

/**
 * What earlier frames or rows of a session left open, for the frames and rows after them (rule 5, and the frame of a
 * task's end, which says nothing of the background alone). The module's own: a caller starts from `nothingOpen` and
 * passes back what `readNext` returned. Immutable: `readNext` returns a new value where anything changed.
 */
export interface OpenArrivals {
  /** The tasks the wire said started, by task id: their type, and whether they were in the background (`task_started`, `task_updated`). */
  readonly tasks: ReadonlyMap<string, { readonly type: string; readonly background: boolean }>;
  /** The runs whose `system/task_notification` said the report was handed back (`handback: 'send'`). */
  readonly handedBack: ReadonlySet<string>;
  /** The tasks whose hand-back waits for the task's next notification, which it claims, and no later one. */
  readonly handbacks: ReadonlySet<string>;
  /** A terminal's fire row, until the meta `user` row after it; `adjacent` while no other row has come between. */
  readonly fire: { readonly uuid: string; readonly adjacent: boolean } | null;
}

export const nothingOpen: OpenArrivals = Object.freeze({ tasks: new Map(), handedBack: new Set<string>(), handbacks: new Set<string>(), fire: null });

/** Every arrival one wire frame or one transcript row carries, in order. Empty for the person's typed prompt and for anything that is no arrival. */
export function readArrivals(row: unknown): Arrival[] {
  return readNext(row, nothingOpen).arrivals;
}

/**
 * The same reading in order (rule 5). `open` is what earlier frames or rows of the session left open: a run whose report
 * was handed back, a hand-back whose task notification has not come, a fire row, the tasks that were in the background.
 * A frame or row that is the second carrier of an arrival already read yields none. A caller gives it every frame or row
 * of a session in order, the ones that carry no arrival too.
 */
export function readNext(row: unknown, open: OpenArrivals): { arrivals: Arrival[]; open: OpenArrivals } {
  const record = object(row);
  const read = record === null ? { arrivals: [], open } : readRecord(record, open);
  const fire = read.open.fire;
  return fire !== null && fire.adjacent && !isFireRow(record) ? { arrivals: read.arrivals, open: { ...read.open, fire: { ...fire, adjacent: false } } } : read;
}

/** Whose turn it is when the arrival opens one: `own` and `consent` are the person's, `peer` a peer's, every other class the engine's. */
export function turnOriginOf(arrival: Arrival): 'human' | 'peer' | 'engine' {
  if (arrival.class === 'own' || arrival.class === 'consent') return 'human';
  return arrival.class === 'peer' ? 'peer' : 'engine';
}

/**
 * MAWS's own answer envelope that a whole text is, read as the split reads a person's message (ticket 704; the Decision
 * Log's ruling of 2026-11-16): one envelope from the writer's whole first line (`askSteerOpening`) to the text's last
 * byte, by `envelopeSlices`. Null for any other text: one that holds an envelope beside anything else, white space
 * included, or that opens with the tag and other words. A reader of a person's message asks `answerEnvelopeOf`
 * (persons-message.ts), which reads its content through this.
 */
export function readAnswerEnvelope(text: string): Answer | null {
  const { members } = envelopeSlices(text, askSteerOpening, PASTED_BLOCK, parseAskSteer);
  const [only] = members;
  return members.length === 1 && only!.text === text ? { class: 'answer', tool: 'maws', call: only!.read.askId, summary: text, answers: only!.read.result.answers, dismissed: false } : null;
}

type AskSteer = NonNullable<ReturnType<typeof parseAskSteer>>;

/**
 * MAWS's answer envelopes inside a user text the engine may have joined from several waiting messages (members in order,
 * one newline between, under the last one's uuid; U4a's decision 32 c), and the rest of the text (the UX wave, U4b: the
 * Decision Log's line on the architect's medium review, form (b), and on the architect's review of the joined answer).
 * An envelope opens at the writer's whole first line (`opening`, `askSteerOpening`), and is the shortest slice from
 * there that `read` takes whole and that ends the text or a line, before the next such line: shortest and bounded, so a
 * later member is never swallowed. A line that opens nothing stays text, as does an opening whose slices are never
 * read. A pasted segment's body is data (`pasted`, `PASTED_BLOCK`, global): none of its lines opens or ends an envelope,
 * so an envelope pasted as a log stays in its segment, whole. The rest is the other members, the newline that separated
 * each envelope gone; a text that is all envelope has an empty rest. Each member is the slice's bytes and what `read`
 * made of it. It uses its arguments alone: the search text's worker runs its source (ticket 704, decision 8), so its
 * helpers live inside it.
 *
 * Past the bound (ticket 704, the architect's ruling of 2026-11-16 on the cascade reviews, A): an earlier build wrote
 * the model's question verbatim, so an envelope's own lines may hold another ask's whole opening line, which bounds it
 * out, while that inner line's slice ends at a block naming the outer ask, which `read` refuses. Only where the bounded
 * reading takes nothing, one reading past the bound: the shortest slice from an opening line that `read` takes whole,
 * the inner opening lines ignored, tried from the last opening line to the first, and one taken. The reader's loop
 * (`takeEnvelopesOut`) reads again until a reading takes nothing, so every bounded reading runs before any reading past
 * the bound. That order keeps three things:
 * 1. Decision 17's nested case is unchanged: an envelope whole inside another's lines is taken by the bound first, so
 *    the reading past it never runs there; the next reading takes the outer one.
 * 2. A later valid member is never swallowed: a member the bound can read is taken before any reading past the bound,
 *    and the openings are tried from the last, so a slice taken past the bound holds only opening lines that read
 *    nothing from themselves. A malformed member before a valid one is left as text: once the valid one is out, no
 *    block names the malformed one's ask.
 * 3. Such an envelope reads as one answer, and nothing of it is the person's.
 * A slice still ends only at a block naming its opening's ask (`read`), and never inside a pasted segment. The reading
 * past the bound runs only in a text of a few opening lines (`PAST_THE_BOUND_OPENINGS`).
 */
export function envelopeSlices<T>(text: string, opening: (askId: string) => string, pasted: RegExp, read: (slice: string) => T | null): { members: { text: string; read: T }[]; rest: string } {
  if (!text.includes('[MAWS ask ')) return { members: [], rest: text }; // read on every user text the transcript draws
  // A line that opens an envelope: the whole first line the writer writes. A line that only begins with the tag (the
  // model's question, header and labels are written verbatim) opens nothing. The tag's id as `parseAskSteer` reads it.
  const opens = (line: string): boolean => {
    const id = /^\[MAWS ask ([^\]\s]+)\] /.exec(line)?.[1];
    return id !== undefined && line === opening(id);
  };
  const lines = text.split('\n');
  // Which lines start inside a pasted segment, from its opening tag through its closing one (the terminal's frame, as
  // the transcript's `splitPastedSegments` reads it).
  const spans = [...text.matchAll(pasted)].map((match) => {
    const whole = match[0];
    return { from: match.index + /^\n*/.exec(whole)![0].length, to: match.index + whole.length - /\n*$/.exec(whole)![0].length };
  });
  let offset = 0;
  const inPasted = lines.map((line) => {
    const at = offset;
    offset += line.length + 1;
    return spans.some(({ from, to }) => at >= from && at < to);
  });
  // The shortest run of lines from `start` that reads whole as an envelope, and the line after it; null where none does.
  // A run ends before the next opening line: `parseAskSteer` pairs the first tag with the last result block, so a
  // malformed member would otherwise run over the words and the envelope after it (the joined answer's task review).
  // Past the bound (`bounded` false), a later opening line does not end the run.
  const envelopeAt = (start: number, bounded: boolean): { member: { text: string; read: T }; next: number } | null => {
    for (let last = start; last < lines.length; last++) {
      if (inPasted[last]) continue; // a slice may hold a pasted segment whole, never end inside one
      if (bounded && last > start && opens(lines[last]!)) return null;
      if (!lines[last]!.endsWith('```')) continue; // the result block's close ends every envelope
      const slice = lines.slice(start, last + 1).join('\n');
      const value = read(slice);
      if (value !== null) return { member: { text: slice, read: value }, next: last + 1 };
    }
    return null;
  };
  const members: { text: string; read: T }[] = [];
  const kept: string[] = [];
  const starts: number[] = [];
  for (let i = 0; i < lines.length; ) {
    const isOpening = !inPasted[i] && opens(lines[i]!);
    const found = isOpening ? envelopeAt(i, true) : null;
    if (found === null) {
      if (isOpening) starts.push(i);
      kept.push(lines[i]!);
      i += 1;
      continue;
    }
    members.push(found.member);
    i = found.next;
  }
  if (members.length > 0) return { members, rest: kept.join('\n') };
  // The most opening lines outside a pasted segment a text may hold for the reading past the bound to run (the
  // architect's ruling of 2026-11-16, A3). That reading searches to the text's end from each opening line, for each
  // envelope the loop takes, so its work grows with the square of the opening lines. A joined message holds one opening
  // line per answer waiting at one turn's end, and an earlier build's envelope one more only where the model wrote one
  // into its question (no recording holds such a question); eight leaves room for several of each. A text with more is
  // left as it is, and the grant readers fail closed on it (A2).
  const PAST_THE_BOUND_OPENINGS = 8;
  if (starts.length > PAST_THE_BOUND_OPENINGS) return { members, rest: text };
  // The bound took nothing, so every opening line is still in the text: one reading past it, from the last
  for (const start of starts.reverse()) {
    const found = envelopeAt(start, false);
    if (found !== null) return { members: [found.member], rest: [...lines.slice(0, start), ...lines.slice(found.next)].join('\n') };
  }
  return { members, rest: text };
}

/** The envelopes inside a text as `parseAskSteer` reads them, and the rest: `envelopeSlices` with the writer's opening line,
 *  the pasted segment and `parseAskSteer` (U4b's answer, kept). A caller that needs a member's bytes calls `envelopeSlices`. */
export function readAnswerEnvelopes(text: string): { envelopes: AskSteer[]; rest: string } {
  const { members, rest } = envelopeSlices(text, askSteerOpening, PASTED_BLOCK, parseAskSteer);
  return { envelopes: members.map((member) => member.read), rest };
}

type Consent = Extract<Arrival, { class: 'consent' }>;
type GrantKind = Consent['kind'];

/**
 * The one definition of the consent sentence: U1c sends it, the reader matches it whole. It is the engine's own
 * "Recently blocked" sentence for one call (`cli.pretty.js` of 2.1.322, `Yn`, the template that ends "if you would
 * like."), the command or the call's input quoted as one JSON string in the engine's encoding (`quoted`).
 */
export function consentMessage(kind: GrantKind, subject: string): string {
  return grantSentence(kind, [quoted(subject)]);
}
export { GRANT_OPENING, quotesGrant } from './grant'; // board ticket 711: the one definition, in a module with no imports

// UX wave U1c (the U1c document, Design 2 and Interfaces §C, 1): the engine quotes each subject as JSON, then escapes
// every invisible or separator character but the plain space as `\uXXXX`, one escape per UTF-16 unit (`Dp`, `Pp`), so
// such a character is visible in the sentence the model reads. For printable ASCII it is `JSON.stringify` alone.
const INVISIBLE = /(?! )[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]/gu;
const escapedUnits = (match: string): string => Array.from({ length: match.length }, (_, i) => `\\u${match.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');
const quoted = (subject: string): string => JSON.stringify(subject).replace(INVISIBLE, escapedUnits);

/** The engine's sentence for one call or for several (`Yn`), its subjects already quoted. */
function grantSentence(kind: GrantKind, subjects: readonly string[]): string {
  const one = subjects.length === 1;
  const these = one ? `this exact ${kind}` : `these exact ${kind}s`;
  return `${grantHead(kind, one)}${subjects.join(', ')}. This does not approve any other ${kind}, any part of ${one ? 'this one' : 'these'}, or running ${one ? 'it' : 'them'} with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry ${these} if you would like.`;
}
const grantHead = (kind: GrantKind, one: boolean): string => `${GRANT_OPENING}${one ? `this exact ${kind}` : `these exact ${kind}s`} only, ${one ? 'as one whole string' : 'each as one whole string'}: `;

/**
 * The grants a text is, whole, from its first word to its last, in order: the sentence for one call or the engine's
 * for several (read from the bundle; no recording holds it), every subject in the engine's encoding or every one in the
 * plain one (what builds before U1c sent, and what a person may paste). None for any other text, one word changed
 * included: the text must equal the sentence rebuilt from what was parsed.
 */
export function readConsents(text: string): Consent[] {
  for (const kind of ['command', 'call'] as const) {
    for (const one of [true, false]) {
      const head = grantHead(kind, one);
      if (!text.startsWith(head)) continue;
      const subjects = quotedStrings(text, head.length);
      if (subjects === null || (one ? subjects.length !== 1 : subjects.length < 2)) continue;
      if (grantSentence(kind, subjects.map(quoted)) === text || grantSentence(kind, subjects.map((subject) => JSON.stringify(subject))) === text) {
        return subjects.map((subject) => ({ class: 'consent', kind, subject }));
      }
    }
  }
  return [];
}

/** The JSON strings at `from`, separated by ", ", up to the first character that follows none; null when none parses there. */
function quotedStrings(text: string, from: number): string[] | null {
  const subjects: string[] = [];
  let at = from;
  for (;;) {
    if (text[at] !== '"') return subjects.length > 0 ? subjects : null;
    let end = at + 1;
    while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
    if (end >= text.length) return null;
    try {
      subjects.push(JSON.parse(text.slice(at, end + 1)) as string);
    } catch {
      return null;
    }
    if (!text.startsWith(', "', end + 1)) return subjects;
    at = end + 3;
  }
}

/**
 * The grants in the person's own text (rule 1): the whole text's, else, for a text that holds a line break, those of
 * each of the person's own lines that is a whole sentence, in order. The engine joins waiting messages with one line
 * break, and a sentence holds none (its subjects are quoted), so in a joined message each grant is one line (the U1c
 * document, Design 2). A grant is read only in the person's own words (Decision Log 52): never on a line of MAWS's
 * answer envelope nor inside a pasted segment, where a sentence is data; one MAWS does not read leaves its blocked row
 * with its button. The person's own words are their part as the split reads it (`readPersonsContent`; ticket 704);
 * a part that still holds an envelope's opening line yields none (`holdsEnvelopeOpening`).
 */
export function personsGrants(content: PersonsContent): Consent[] {
  const { own } = readPersonsContent(content);
  if (own === null || holdsEnvelopeOpening(own)) return [];
  const text = messageText(own);
  const whole = readConsents(text);
  if (whole.length > 0 || !text.includes('\n') || !text.includes(GRANT_OPENING)) return whole;
  return ownLines(content).flatMap(({ line, pasted }) => (pasted ? [] : readConsents(line)));
}

/**
 * Whether a person's part, MAWS's envelopes already taken out, still holds the whole first line of an envelope
 * (`askSteerOpening` of the id its tag names) outside a pasted segment. Such a part yields no grant, whatever the reason
 * the line is still there: an envelope cut before its block or spread over two blocks (decision 7), one past the
 * reader's bound on its work, or a reading the reader got wrong (ticket 704, the architect's ruling of 2026-11-16 on the
 * cascade reviews, A2: a defence at the grant readers that does not rest on the parse). A sentence near such a line may
 * be the model's, quoted in an envelope, so the grant readers fail closed and the blocked row keeps its button.
 */
export function holdsEnvelopeOpening(own: PersonsContent): boolean {
  const text = messageText(own);
  if (!text.includes('[MAWS ask ')) return false;
  const lines = text.split('\n');
  const pasted = pastedLines(text, lines);
  return lines.some((line, i) => {
    const id = /^\[MAWS ask ([^\]\s]+)\] /.exec(line)?.[1];
    return !pasted[i] && id !== undefined && line === askSteerOpening(id);
  });
}

/**
 * The lines of the person's part of a message (`readPersonsContent`'s `own`, its text blocks joined by a line break as
 * the reader joins them everywhere), each marked when it starts inside a pasted segment; none when nothing of theirs is
 * left. The person's words are the lines not marked.
 */
export function ownLines(content: PersonsContent): { line: string; pasted: boolean }[] {
  const { own } = readPersonsContent(content);
  if (own === null) return [];
  const text = messageText(own);
  const lines = text.split('\n');
  const pasted = pastedLines(text, lines);
  return lines.map((line, i) => ({ line, pasted: pasted[i]! }));
}

/** A person's message's content: a text, or its blocks. */
export type PersonsContent = string | ContentBlock[];

/**
 * A person's content with MAWS's answer envelopes taken out: the one reading of a person's message (ticket 704; the
 * Decision Log's ruling of 2026-11-16), which the split reads it through (`personsParts`, persons-message.ts) and the
 * grant readers here too. Each text block by itself (decision 7): an envelope spread over two blocks is not read, since
 * the writer makes one text; a block left empty goes, every other block stays, in place and unchanged. Each text is
 * read again until a reading takes nothing out (decision 17): where one envelope's lines stand around another whole
 * envelope, the first reading takes the inner one and leaves the outer one whole. `own` is null when nothing of the
 * person's is left, white space beside an envelope counting as nothing (the separating newline the engine appends to
 * an envelope's text block, or puts between members). The envelopes in the order they were taken, each with what was
 * read of it.
 */
export function readPersonsContent(content: PersonsContent): { own: PersonsContent | null; envelopes: { text: string; read: AskSteer }[] } {
  if (typeof content === 'string') {
    const read = readOut(content);
    return { own: leftOf(read), envelopes: read.envelopes };
  }
  const envelopes: { text: string; read: AskSteer }[] = [];
  const kept: ContentBlock[] = [];
  for (const block of content) {
    const read = block.type === 'text' && typeof block.text === 'string' ? readOut(block.text) : null;
    if (read === null || read.envelopes.length === 0) {
      kept.push(block);
      continue;
    }
    envelopes.push(...read.envelopes);
    const own = leftOf(read);
    if (own !== null) kept.push({ ...block, text: own });
  }
  return { own: kept.length === 0 ? null : kept, envelopes };
}

// One text read with the window's check of a whole slice
const readOut = (text: string) => takeEnvelopesOut(text, (own) => envelopeSlices(own, askSteerOpening, PASTED_BLOCK, parseAskSteer));

/**
 * The envelopes `slice` reads in a text, read again until a reading takes nothing out (ticket 704, decision 17): where
 * one envelope's lines stand around another whole envelope, the first reading takes the inner one and leaves the outer
 * one whole, and the next takes it. Each reading that takes something shortens the text by an envelope at least, so it
 * ends. The envelopes in the order they were taken, and what is left. The one loop: `readPersonsContent` reads through
 * it, and the search text's worker runs its source, so it uses its arguments alone.
 */
export function takeEnvelopesOut<T>(text: string, slice: (text: string) => { members: { text: string; read: T }[]; rest: string }): { own: string; envelopes: { text: string; read: T }[] } {
  const envelopes: { text: string; read: T }[] = [];
  let own = text;
  for (;;) {
    const { members, rest } = slice(own);
    if (members.length === 0) return { own, envelopes };
    envelopes.push(...members);
    own = rest;
  }
}
const leftOf = (read: { own: string; envelopes: readonly unknown[] }): string | null => (read.own === '' || (read.envelopes.length > 0 && read.own.trim() === '') ? null : read.own);

// Which lines start inside a pasted segment, from its opening tag through its closing one (the terminal's frame,
// `PASTED_BLOCK`, as the transcript's `splitPastedSegments` reads it).
function pastedLines(text: string, lines: readonly string[]): boolean[] {
  const spans = [...text.matchAll(PASTED_BLOCK)].map((match) => {
    const whole = match[0];
    return { from: match.index + /^\n*/.exec(whole)![0].length, to: match.index + whole.length - /\n*$/.exec(whole)![0].length };
  });
  let offset = 0;
  return lines.map((line) => {
    const at = offset;
    offset += line.length + 1;
    return spans.some(({ from, to }) => at >= from && at < to);
  });
}

type Read = { arrivals: Arrival[]; open: OpenArrivals };
const none = (open: OpenArrivals): Read => ({ arrivals: [], open });

function readRecord(row: Json, open: OpenArrivals): Read {
  switch (row.type) {
    case 'user':
      return userRow(row, open);
    case 'attachment':
      return attachmentRow(row, open);
    case 'assistant':
      return { arrivals: commandOfFrame(row), open };
    case 'system':
      return systemRecord(row, open);
    case 'command_lifecycle':
      // A scheduled fire on the live wire (probe 2): no `user` frame, and the prompt's text is not on the wire.
      return { arrivals: row.state === 'started' && row.wakeup_source === 'schedule_wakeup' ? [{ class: 'schedule', prompt: null }] : [], open };
    default:
      return none(open);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// `user` frames and rows

function userRow(row: Json, open: OpenArrivals): Read {
  const content = object(row.message)?.content;
  if (Array.isArray(content) && content.length > 0 && content.every((block) => object(block)?.type === 'tool_result')) return none(open); // a tool's result continues the turn
  const origin = object(row.origin);
  const kind = origin?.kind;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? messageText(content.filter(isBlock)) : null;
  if (text === null) return none(open);
  if (kind === 'human') return { arrivals: personsPrompt(row, text), open };
  if (kind === 'peer' || (kind === undefined && parsePeerMessage(text)?.kind === 'teammate')) return peerMessage(text, origin, null, open);
  if (kind === 'plugin') return { arrivals: pluginRow(row), open };
  const notifications = notificationText(text, kind);
  if (notifications !== null) return notificationsOf(notifications, string(origin?.runId), open);
  if (row.turnOrigin === 'scheduled') return scheduledRow(row, text, open);
  return { arrivals: commandOfText(text, kind), open };
}

/**
 * The person's own prompt: never an arrival, but for MAWS's own texts (its answer envelope, its consent message) and, in
 * a background session sminos spawned, a prompt that opens with a whole frame line (decision 19). The session's kind is
 * read on the row itself: a row without it is the person's typed prompt, whatever its first line.
 */
function personsPrompt(row: Json, text: string): Arrival[] {
  const content = object(row.message)?.content;
  if (row.sessionKind === 'bg' && typeof content === 'string') {
    const delivery = framedDelivery(content, 'prompt', false);
    if (delivery !== null) return [delivery];
  }
  return personsText(Array.isArray(content) ? content.filter(isBlock) : text); // block by block, as the split reads it (ticket 704)
}

// One answer per envelope the person's content holds, as the split takes them (rule 3; ticket 704, decisions 7, 12 and
// 17), its summary the envelope's own text, as a lone envelope's is; then the grants in the person's own words (U1c),
// never on an envelope's lines: a text that is one envelope is no grant, nor are its lines. Read block by block: where
// the readings could differ (an envelope spread over two blocks), the split's wins, the one reading the ruling names.
function personsText(content: PersonsContent): Arrival[] {
  const answers = readPersonsContent(content).envelopes.map(({ text: summary, read }): Answer => ({ class: 'answer', tool: 'maws', call: read.askId, summary, answers: read.result.answers, dismissed: false }));
  return [...answers, ...personsGrants(content)];
}

/** A row or a queued command of the peer origin (or a teammate's, which has none): the engine's inbox. */
function peerMessage(text: string, origin: Json | null, queuedPrompt: string | null, open: OpenArrivals): Read {
  const parsed = parsePeerMessage(text);
  if (parsed === null) {
    // An engine through 2.1.289 queued an inbox delivery raw, the frame the prompt's own first line.
    const raw = queuedPrompt === null ? null : framedDelivery(queuedPrompt, 'inbox', true);
    return { arrivals: raw === null ? [] : [raw], open };
  }
  if (parsed.kind === 'agent') {
    const report = handbackReport(parsed.body);
    const taskId = string(origin?.senderTaskId);
    const arrival: Arrival = { class: 'subagent', agentId: parsed.fromAgentId, body: parsed.body, report, taskId };
    return { arrivals: [arrival], open: report !== null && taskId !== null ? { ...open, handbacks: added(open.handbacks, taskId) } : open };
  }
  if (parsed.kind === 'teammate') return { arrivals: inboxPeer(text, origin, parsed.frame, 'team'), open };
  if (parsed.frame !== null) {
    const sender = sminosFrameSender(parsed.frame);
    return { arrivals: sender === 'human' ? [own('chat', parsed.frame, parsed.body)] : inboxPeer(text, origin, parsed.frame, 'inbox'), open };
  }
  const first = firstLine(parsed.body);
  if (first === STEER_LINE && parsed.body.length > STEER_LINE.length) return { arrivals: [own('steer', STEER_LINE, parsed.body.slice(STEER_LINE.length + 1))], open }; // X-032: `sminos steer`'s inbox fallback
  if (first === BRIDGE_WAKE_LINE) return { arrivals: [{ class: 'wake' }], open };
  return { arrivals: inboxPeer(text, origin, null, 'inbox'), open };
}

/** A peer's message by the engine's inbox (or a teammate's), as its companion event reads it (`peerEventsOf`). */
function inboxPeer(text: string, origin: Json | null, frame: string | null, via: 'inbox' | 'team'): Peer[] {
  const payload = peerEventsOf(text, null, origin);
  if (payload?.kind !== 'peer.message') return [];
  return [
    {
      class: 'peer', via, sender: { name: payload.fromName, address: payload.from, session: payload.fromSession, owners: frame === null ? null : (sminosFrameOwners(frame)?.owners ?? null) },
      body: payload.text, frame, midTurn: payload.midTurn, lineage: payload.lineage, replyTo: payload.replyable ? payload.from : null,
    },
  ];
}

/**
 * A row of the bridge's plugin: its answer prompt, its wake, or a delivery it submitted as the user or appended into the
 * running turn. UX wave U1c (M4, Interfaces §C, 6): a row a bridge plugin submitted as the user whose whole text is the
 * grant is the grant it carried for the person (MAWS's "Approve and retry" through the terminal's bridge, probe T); a
 * row that opens with a sminos frame line is read as the delivery it is, before this.
 */
function pluginRow(row: Json): Arrival[] {
  const answers = answersOf(row);
  if (answers.length > 0) return answers;
  if (isBridgeWake(row)) return [{ class: 'wake' }];
  const prompts = deliveredPrompts(row);
  if (prompts === null || (prompts.kind !== 'submitted' && prompts.kind !== 'appended')) return [];
  const appended = prompts.kind === 'appended';
  if (appended) {
    const steer = markedSteerWords(row);
    if (steer !== null) return [own('steer', STEER_LINE, steer)];
  }
  const text = deliveredText(prompts);
  const delivery = text === null ? null : framedDelivery(text, 'bridge', appended);
  if (delivery !== null) return [delivery];
  if (appended || !isBridgePlugin(object(row.origin)?.name)) return [];
  // the grant is the row's whole content, every block of it (never its first text block alone): a string, or text
  // blocks alone, joined by a line break as the reader joins them everywhere, so that only one block can hold it
  const whole = typeof prompts.content === 'string' ? prompts.content : textBlocksText(prompts.content);
  return whole === null ? [] : readConsents(whole);
}
const isBridgePlugin = (name: unknown): boolean => (BRIDGE_PLUGINS as readonly unknown[]).includes(name);

/**
 * A delivery whose text opens with sminos's whole frame line, the words after it: the person's own when the frame names
 * `human`, else a peer's, named by the frame's alias (no address: neither the bridge nor a seat's prompt carries one).
 */
function framedDelivery(text: string, via: 'bridge' | 'prompt' | 'inbox', midTurn: boolean): Own | Peer | null {
  const { frame, body } = sminosParts(text);
  if (frame === null) return null;
  const sender = sminosFrameSender(frame)!;
  if (sender === 'human') return own('chat', frame, body);
  return {
    class: 'peer', via, sender: { name: sminosFrameAlias(frame), address: '', session: null, owners: sminosFrameOwners(frame)?.owners ?? null },
    body, frame, midTurn, lineage: 'peer', replyTo: null,
  };
}

/**
 * UX wave U3b (Interfaces §D, Probes 5): a prompt's text as the person's own words. Where it opens with a whole sminos
 * frame line that names `human`, the words after it, as the `own` class reads them (with its guard for words that read
 * as the interrupt marker); else the text. The rewind's text of a prompt sminos delivered opens with that line.
 * MAWS's answer envelopes are never the person's words, in either form (board ticket 711): a text that holds one is
 * read without it, as the split reads a person's message (`readPersonsContent`, the reader's one loop; ticket 704), so
 * an envelope alone reads as no words.
 */
export function ownWordsOf(text: string): string {
  const words = (readPersonsContent(text).own as string | null) ?? '';
  const { frame, body } = sminosParts(words);
  return frame !== null && sminosFrameSender(frame) === 'human' ? own('chat', frame, body).words : words;
}

/** The person's own words sminos delivered; words that alone would read as the engine's interrupt marker keep their frame line before them. */
function own(via: 'chat' | 'steer', frame: string, words: string): Own {
  return { class: 'own', via, words: INTERRUPT_MARKER.test(words.trim()) ? `${frame}\n${words}` : words, frame };
}

/**
 * A meta `user` row of a scheduled fire (`turnOrigin: 'scheduled'`, probe 2: no origin object on any route), its text
 * the prompt: the arrival, unless a terminal's fire row before it is (rule 5), tied by `scheduledFireId` where the engine
 * wrote one, else by its place directly after.
 */
function scheduledRow(row: Json, text: string, open: OpenArrivals): Read {
  const fire = open.fire;
  const fireId = string(row.scheduledFireId);
  if (fire !== null && (fireId !== null ? fireId === fire.uuid : fire.adjacent)) return { arrivals: [], open: { ...open, fire: null } };
  return { arrivals: [{ class: 'schedule', prompt: text }], open };
}

// ---------------------------------------------------------------------------------------------------------------------
// Attachments: what the engine took in at a tool boundary or with the person's next prompt, and a hook's added context

function attachmentRow(row: Json, open: OpenArrivals): Read {
  const attachment = object(row.attachment);
  if (attachment?.type === 'hook_additional_context') return { arrivals: answersOf(row), open };
  if (attachment?.type !== 'queued_command') return none(open);
  const origin = object(attachment.origin);
  const persons = origin?.kind === 'human' && attachment.commandMode === 'prompt' && attachment.isMeta !== true;
  if (typeof attachment.prompt !== 'string') {
    // UX wave U1c (M4, Interfaces §C, 7): a prompt of the person's whose content is text blocks alone, the form the
    // reader of another machine's rows gives a row a sminos bridge appended into the running turn (`steerAsDrawn`),
    // is read for the grant whole, as the bridge's words are on every route (§C, 6 and 8)
    const text = persons ? textBlocksText(attachment.prompt) : null;
    return text === null ? none(open) : { arrivals: readConsents(text), open };
  }
  const prompt = attachment.prompt;
  if (attachment.commandMode === 'task-notification') {
    if (attachment.isMeta === true) return none(open); // context, as the backfill reads it today
    const notifications = notificationText(prompt, origin?.kind ?? 'task-notification');
    return notifications === null ? none(open) : notificationsOf(notifications, string(attachment.runId) ?? string(origin?.runId), open);
  }
  if (origin?.kind === 'peer') {
    // The text the model read (`rendered`: the header and the trailer around the envelope) says more than the bare
    // prompt (whether the sender is inside this session), as the backfill's companion reads it.
    const rendered = Array.isArray(row.rendered) ? (row.rendered as unknown[]).map((part) => object(part)?.content).find((part): part is string => typeof part === 'string') : undefined;
    const text = rendered !== undefined && parsePeerMessage(rendered) !== null ? rendered : prompt;
    return peerMessage(text, origin, prompt, open);
  }
  if (origin?.kind === 'plugin') {
    // The bridge's submission into a running turn before doperpowers PR 233 appended it instead.
    const delivery = framedDelivery(prompt, 'bridge', true);
    return { arrivals: delivery === null ? [] : [delivery], open };
  }
  if (persons) return { arrivals: personsText(prompt), open };
  return none(open);
}

/** The text of content that is text blocks and nothing else, one or more; null for any other. */
function textBlocksText(content: unknown): string | null {
  if (!Array.isArray(content) || content.length === 0 || !content.every((block) => object(block)?.type === 'text' && typeof object(block)!.text === 'string')) return null;
  return messageText(content.filter(isBlock));
}

/** The answers a plugin's prompt or a hook's context delivers, one arrival each, in order (rule 3). */
function answersOf(row: Json): Answer[] {
  return askAnswers(row).map(({ call, text }) => ({ class: 'answer', tool: 'sminos', call, summary: text, answers: null, dismissed: text === DISMISSED }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Task notifications

/**
 * The blocks of a notification carrier, each one arrival (rule 3), but the one a hand-back already read (rule 5: the
 * hand-back claims its task's next notification; on the live wire, a run the frame said was handed back). The carrier's
 * run is a single block's.
 */
function notificationsOf(text: string, carrierRun: string | null, open: OpenArrivals): Read {
  const blocks = taskNotificationBlocks(text);
  const runId = blocks.length === 1 ? carrierRun : null;
  let { handbacks, handedBack } = open;
  const arrivals: Arrival[] = [];
  for (const block of blocks) {
    if (block.taskId !== null && handbacks.has(block.taskId)) {
      handbacks = removed(handbacks, block.taskId);
      if (runId !== null && handedBack.has(runId)) handedBack = removed(handedBack, runId);
      continue;
    }
    if (runId !== null && handedBack.has(runId)) {
      handedBack = removed(handedBack, runId);
      continue;
    }
    arrivals.push({ class: 'task', taskId: block.taskId, toolUseId: block.toolUseId, runId, outcome: block.outcome, summary: block.summary, durationMs: block.durationMs, outputFile: block.outputFile, detail: block.detail });
  }
  return { arrivals, open: handbacks === open.handbacks && handedBack === open.handedBack ? open : { ...open, handbacks, handedBack } };
}

// ---------------------------------------------------------------------------------------------------------------------
// `system` frames and rows

function systemRecord(row: Json, open: OpenArrivals): Read {
  switch (row.subtype) {
    case 'task_started':
      return { arrivals: [], open: taskStarted(row, open) };
    case 'task_updated': {
      const id = string(row.task_id);
      const known = id === null ? undefined : open.tasks.get(id);
      if (id === null || object(row.patch)?.is_backgrounded !== true || known?.background === true) return none(open);
      return { arrivals: [], open: { ...open, tasks: withEntry(open.tasks, id, { type: known?.type ?? '', background: true }) } };
    }
    case 'task_notification':
      return taskFrame(row, open);
    case 'scheduled_task_fire': {
      const uuid = string(row.uuid);
      return { arrivals: [{ class: 'schedule', prompt: string(row.prompt) }], open: uuid === null ? open : { ...open, fire: { uuid, adjacent: true } } };
    }
    case 'local_command':
    case 'local_command_output':
      // UX wave U3b (Interfaces A): a `local_command` row names the command the engine ran as the frame does (`commandRun`)
      return { arrivals: typeof row.content === 'string' ? commandOfText(row.content, undefined, row.subtype === 'local_command' ? runOf(row.commandRun) : null) : [], open };
    default:
      return none(open);
  }
}

/** A task's start: its type and whether it runs in the background; a new run of a task ends what its earlier hand-back claimed. */
function taskStarted(row: Json, open: OpenArrivals): OpenArrivals {
  const id = string(row.task_id);
  if (id === null) return open;
  const tasks = withEntry(open.tasks, id, { type: string(row.task_type) ?? '', background: row.is_backgrounded === true });
  return { ...open, tasks, handbacks: open.handbacks.has(id) ? removed(open.handbacks, id) : open.handbacks };
}

/**
 * The live wire's `system/task_notification` frame: a carrier only for a background command or monitor (task type
 * `local_bash`, in the background by its start or a later update) that completed or failed, with a run, whose `summary`
 * is then the engine's sentence (probe 1). A foreground command's frame, a stopped task's (whose `summary` is its
 * description) and an agent's (the hand-back's note) are none. An agent's frame that says its report was handed back
 * marks the run, so the replayed frame that names it yields nothing (rule 5).
 */
function taskFrame(row: Json, open: OpenArrivals): Read {
  const [id, runId, summary] = [string(row.task_id), string(row.run_id), string(row.summary)];
  const handedBack = row.handback === 'send' && runId !== null ? added(open.handedBack, runId) : open.handedBack;
  const task = id === null ? undefined : open.tasks.get(id);
  const tasks = id !== null && task !== undefined ? without(open.tasks, id) : open.tasks;
  const next = { ...open, tasks, handedBack };
  const outcome = row.status === 'completed' || row.status === 'failed' ? row.status : null;
  if (task?.type !== 'local_bash' || !task.background || outcome === null || runId === null || summary === null) return { arrivals: [], open: next };
  const output = string(row.output_file);
  const arrival: Task = { class: 'task', taskId: id, toolUseId: string(row.tool_use_id), runId, outcome, summary, durationMs: null, outputFile: output === '' ? null : output, detail: null };
  return { arrivals: [arrival], open: next };
}

// ---------------------------------------------------------------------------------------------------------------------
// A slash command's output

/** The assistant frame the engine writes for a command's output (`local_command_source`, probe 4), never a model's answer. */
function commandOfFrame(row: Json): Arrival[] {
  if (typeof row.local_command_source !== 'string') return [];
  const parts = localCommandParts(row.local_command_source);
  return parts === null ? [] : [commandOutput(parts, runOf(row.local_command_run))];
}

/** A `user` frame or row, or a terminal's `system` row, whose whole text is a command's output tags; never the person's own text. */
function commandOfText(text: string, originKind: unknown, run: Command['run'] = null): Arrival[] {
  if (originKind === 'human') return [];
  const parts = localCommandParts(text);
  return parts === null ? [] : [commandOutput(parts, run)];
}

/** The command the engine ran, as the frame's `local_command_run` and the file row's `commandRun` name it. */
function runOf(value: unknown): Command['run'] {
  const run = object(value);
  const command = string(run?.command);
  return command === null ? null : { command, args: string(run?.args) ?? '' };
}

/** An output's two tags, a terminal's escapes removed; `plain` where there were any (UX wave U3b, decision 2). */
function commandOutput(parts: { stdout: string; stderr: string }, run: Command['run']): Command {
  const [stdout, stderr] = [stripAnsi(parts.stdout), stripAnsi(parts.stderr)];
  return { class: 'command', run, stdout, stderr, plain: stdout !== parts.stdout || stderr !== parts.stderr };
}

/**
 * What a `user.message` of origin `local-command` says of the outputs it carries (UX wave U3b, Interfaces A): the first
 * run any of them names, and whether any was a terminal's text. The two producers ask it, so `commandEntry` is given the
 * same facts on every route.
 */
export function commandFactsOf(arrivals: readonly Arrival[]): CommandFacts {
  const outputs = arrivals.filter((arrival): arrival is Command => arrival.class === 'command');
  return { run: outputs.find((output) => output.run !== null)?.run ?? null, plain: outputs.some((output) => output.plain) };
}

// ---------------------------------------------------------------------------------------------------------------------

function isFireRow(row: Json | null): boolean {
  return row?.type === 'system' && row.subtype === 'scheduled_task_fire';
}

function object(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}
const string = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const isBlock = (value: unknown): value is { type: string } & Json => typeof object(value)?.type === 'string';
const added = (set: ReadonlySet<string>, value: string): ReadonlySet<string> => new Set([...set, value]);
const removed = (set: ReadonlySet<string>, value: string): ReadonlySet<string> => new Set([...set].filter((item) => item !== value));
function withEntry<V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> {
  return new Map([...map, [key, value]]);
}
function without<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  return new Map([...map].filter(([k]) => k !== key));
}

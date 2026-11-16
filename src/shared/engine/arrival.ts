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
import { ASK_STEER_OPENING, askSteerOpening, parseAskSteer } from '../maws/ask';
import { keptLines, type ReadingWork } from '../maws/ask-strict';
import { holdsGrantForm } from './composed-forms';
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
  const { members } = envelopeSlices(text, askSteerOpening, pastedBodies, parseAskSteer, MAX_ENVELOPE_CHECKS);
  const [only] = members;
  return members.length === 1 && only!.text === text ? { class: 'answer', tool: 'maws', call: only!.read.askId, summary: text, answers: only!.read.result.answers, dismissed: false } : null;
}

type AskSteer = NonNullable<ReturnType<typeof parseAskSteer>>;
const TAG_OPENS = ASK_STEER_OPENING; // an envelope's tag, either form

/**
 * MAWS's answer envelopes inside a user text the engine may have joined from several waiting messages (members in order,
 * one newline between, under the last one's uuid; U4a's decision 32 c), and the rest of the text (the UX wave, U4b: the
 * Decision Log's line on the architect's medium review, form (b), and on the architect's review of the joined answer).
 * An envelope opens at the writer's whole first line (`opening`, `askSteerOpening`), and is the shortest slice from
 * there that `read` takes whole and that ends the text or a line, before the next such line: shortest and bounded, so a
 * later member is never swallowed. A line that opens nothing stays text, as does an opening whose slices are never
 * read. A pasted segment's body is data (`pasted` marks its lines: `pastedBodies`, the one definition): none of its
 * lines opens or ends an envelope, so an envelope pasted as a log stays in its segment, whole. The rest is the other
 * members, the newline that separated each envelope gone; a text that is all envelope has an empty rest. Each member is
 * the slice's bytes and what `read` made of it. A text that would cost more than `maxChecks` calls of `read` (each a
 * join and a scan of a slice; `MAX_ENVELOPE_CHECKS`) is left whole: no member, the rest the text unchanged, so every
 * reader sees one ordinary text. It uses its arguments alone: the search text's worker runs its source (ticket 704,
 * decision 8), so its helpers live inside it.
 */
export function envelopeSlices<T>(text: string, opening: (askId: string) => string, pasted: (lines: readonly string[]) => boolean[], read: (slice: string) => T | null, maxChecks: number): { members: { text: string; read: T }[]; rest: string } {
  const whole = { members: [] as { text: string; read: T }[], rest: text };
  if (!text.includes('[MAWS ask ')) return whole; // read on every user text the transcript draws
  // A line that opens an envelope: the whole first line the writer writes. A line that only begins with the tag (the
  // model's question, header and labels are written verbatim) opens nothing. The tag's id as `parseAskSteer` reads it.
  const opens = (line: string): boolean => {
    const id = /^\[MAWS ask ([^\]\s]+)\] /.exec(line)?.[1];
    return id !== undefined && line === opening(id);
  };
  const lines = text.split('\n');
  const inPasted = pasted(lines);
  let checks = 0;
  // The shortest run of lines from `start` that reads whole as an envelope, and the line after it; null where none does,
  // and 'over' where finding it would take a check past the cap. A run ends before the next opening line:
  // `parseAskSteer` pairs the first tag with the last result block, so a malformed member would otherwise run over the
  // words and the envelope after it (the joined answer's task review).
  const envelopeAt = (start: number): { member: { text: string; read: T }; next: number } | null | 'over' => {
    for (let last = start; last < lines.length; last++) {
      if (inPasted[last]) continue; // a slice may hold a pasted segment whole, never end inside one
      if (last > start && opens(lines[last]!)) return null;
      if (!lines[last]!.endsWith('```')) continue; // the result block's close ends every envelope
      if (checks === maxChecks) return 'over';
      checks += 1;
      const slice = lines.slice(start, last + 1).join('\n');
      const value = read(slice);
      if (value !== null) return { member: { text: slice, read: value }, next: last + 1 };
    }
    return null;
  };
  const members: { text: string; read: T }[] = [];
  const kept: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const found = !inPasted[i] && opens(lines[i]!) ? envelopeAt(i) : null;
    if (found === 'over') return whole;
    if (found === null) {
      kept.push(lines[i]!);
      i += 1;
      continue;
    }
    members.push(found.member);
    i = found.next;
  }
  return { members, rest: kept.join('\n') };
}

/**
 * The most whole-slice checks (`parseAskSteer` on a candidate slice, each one a join and a scan of it) one text may
 * cost. A writer-made envelope costs one, its result block's close being its only line that ends in a fence, and a
 * joined message holds one envelope per answer waiting at a turn's end; so the reader's work on a text stays within
 * this many slices of it (the architect's ruling of 2026-11-16).
 */
export const MAX_ENVELOPE_CHECKS = 64;

/** The envelopes inside a text as `parseAskSteer` reads them, and the rest: `envelopeSlices` with the writer's opening
 *  line, `pastedBodies`, `parseAskSteer` and `MAX_ENVELOPE_CHECKS` (U4b's answer, kept, its shape unchanged). A caller
 *  that needs a member's bytes calls `envelopeSlices`. */
export function readAnswerEnvelopes(text: string): { envelopes: AskSteer[]; rest: string } {
  const { envelopes, rest } = readAnswerEnvelopesWithCost(text);
  return { envelopes, rest };
}

/**
 * What one reading of `readAnswerEnvelopes` cost: its whole-slice checks, and the steps of marking the pasted lines
 * (rule R's `pastedBodies`, the one definition of a pasted segment's lines, linear in the lines; the architect's ruling
 * 3865, in place of the pattern's own search, which was not linear on opening tags that never close).
 */
export interface EnvelopeReadingCost {
  checks: number;
  markingSteps: number;
}

/** `readAnswerEnvelopes`, with what the reading cost, for the tests that pin its bounds: `envelopeSlices` with a
 *  counting `read` and a counting marking. */
export function readAnswerEnvelopesWithCost(text: string): { envelopes: AskSteer[]; rest: string; cost: EnvelopeReadingCost } {
  const cost: EnvelopeReadingCost = { checks: 0, markingSteps: 0 };
  const marking = { lines: 0 };
  const counted = <T>(read: (slice: string) => T | null) => (slice: string): T | null => {
    cost.checks += 1;
    return read(slice);
  };
  const { members, rest } = envelopeSlices(text, askSteerOpening, (lines) => pastedBodies(lines, marking), counted(parseAskSteer), MAX_ENVELOPE_CHECKS);
  cost.markingSteps = marking.lines;
  return { envelopes: members.map((member) => member.read), rest, cost };
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

/** The grants in a person's message (rule R, `personsLines`), in order. */
export function personsGrants(text: string): Consent[] {
  return personsLines(text)?.flatMap((line) => line.grants) ?? [];
}

/**
 * Rule R (the architect's ruling of 2026-11-16, on the wave coordinator's proposal): the one reading of the grants in a
 * person's message, its text blocks joined as `messageText` joins them. Every reader of a grant in a person's message
 * comes here: the host's mark on a frame it writes and the file's rows (`personsText`), the queue's gate (`keysIn`,
 * blocked-call/grants.ts) and the transcript's rows beside the grants (`wordsBesideGrants`, transcript/model/derive.ts).
 * The lines of what is left, each with its grants, or null where the message yields none.
 *
 *  0. A text that is the sentence whole is that grant (`readConsents`), first and as before (Decision Log 52): a sentence
 *     holds no line break, so no envelope can stand in it, and the readers that read a text whole agree with this one.
 *  1. This build's envelopes are taken out strictly, in one forward pass with no pasted-segment logic
 *     (`takeOutEnvelopes`, maws/ask-strict.ts); an opening line that does not read strictly yields no grant.
 *  1b. A message whose whole joined text holds a form MAWS composes around words a model, a command or a page wrote
 *     (the list in composed-forms.ts, the forms it flags for grants) yields no grant; nothing is set aside first (the
 *     architect's ruling 3865, its exemption withdrawn).
 *  2. What is left fails closed: an envelope's tag anywhere in it, or a line that opens a json fence, yields no grant,
 *     pasted or not, and no line is exempt.
 *  3. Otherwise each line of what is left that is a whole sentence gives its grants, but a line inside a pasted segment,
 *     where a sentence is data (`pastedBodies`), of the text as it came or of what is left.
 *
 * Why no sentence a model wrote is read as the person's. Model text reaches a person's message in two ways: inside an
 * answer envelope an earlier build wrote (that build wrote the question's words on the envelope's line), and inside the
 * forms MAWS composes around a model's, a command's or a page's words and sends as the person's (a side question's
 * answers promoted to a thread, the plan handed back after a clear, a `!` command's echo, an artifact's read, a relay,
 * an anchored comment's page text, a recorded slash command, an owner question's answer line). Step 1b answers the
 * forms: each carries a constant its writer writes and nothing removes, so a message holding one yields nothing (board
 * ticket 733 is the writer-side follow-up). Steps 1 and 2 answer the envelopes. A strict envelope's lines are all of
 * the writer's grammar (numbered answer lines, indented paths and notes, the fence, a block of JSON, the close), and none
 * of them is a bare sentence, whoever wrote it, so taking one out leaves none behind. Every envelope of either form
 * carries two lines the host wrote and the model cannot remove or alter: its opening line and the fence line that opens
 * its real result block. An earlier envelope cannot be taken out strictly: its real block holds the question's words
 * in each answer (the tool's input requires a question of at least one character, and the earlier builds' sheet copied
 * them into each answer; the answer's schema itself admits an empty one), so a reading that reaches it fails and
 * yields nothing; and a reading that ends earlier, at a block the model forged in a question, leaves the real fence
 * line after it, and step 2 then yields nothing. Pasted
 * segments are read only in step 3, on a text that holds no envelope's line, so a pasted tag cannot hide one.
 *
 * Linear in the text: each line is looked at a bounded number of times (the take-out once, the check of what is left
 * once, the pasted segments' two passes on the text and two on what is left, the reading once), each block is parsed
 * once, each composed form's reader is a native pass or two over the text, and every test of a line is anchored with
 * no nested repetition. `work` counts it where it is done (arrival.test.ts pins the counts).
 */
export function personsLines(text: string, work: ReadingWork = { lines: 0, blockCharacters: 0, formSteps: 0 }): { line: string; grants: Consent[] }[] | null {
  const whole = readConsents(text);
  if (whole.length > 0) return [{ line: text, grants: whole }];
  if (!text.includes('\n') || !text.includes(GRANT_OPENING)) return null;
  const formWork = { steps: 0 };
  const composed = holdsGrantForm(text, formWork);
  work.formSteps += formWork.steps;
  if (composed) return null;
  const all = text.split('\n');
  const kept = keptLines(all, work);
  if (kept === null) return null;
  const left = kept.map((i) => all[i]!);
  for (const line of left) {
    work.lines += 1;
    if (line.includes(TAG_OPENS) || line.startsWith('```json')) return null;
  }
  // a line inside a segment of the text as it came, or of what is left (R-2: the take-out can free a line from one, or
  // pair an opening tag with another closing tag): either marking only adds skips
  const asCame = pastedBodies(all, work);
  const asLeft = pastedBodies(left, work);
  const lines = left.map((line, i) => {
    work.lines += 1;
    return { line, grants: asCame[kept[i]!] || asLeft[i] ? [] : readConsents(line) };
  });
  return lines.some((line) => line.grants.length > 0) ? lines : null;
}

// Which lines are inside a pasted segment, as `PASTED_BLOCK` finds segments (the terminal's frame, as the transcript's
// `splitPastedSegments` reads it): from a line that ends with an opening tag to the first line, at least two after it,
// that begins with the closing tag of the same id, both marked; the next segment is looked for from that line. Linear:
// every line is looked at once in each of the two passes, and each closing line once more as a segment passes it.
// The one definition: the envelope slicer marks its pasted lines with it too (`envelopeSlices`, given it by
// `readAnswerEnvelopesWithCost`, `readPersonsContent` and the search text's worker, which runs its source), so it uses
// its arguments alone and holds its tags itself.
export function pastedBodies(lines: readonly string[], work: { lines: number } = { lines: 0 }): boolean[] {
  const OPENING_TAG = /^<pasted_content id="([0-9a-f]{4})">$/;
  const CLOSING_TAG = /^<\/pasted_content id="([0-9a-f]{4})">$/;
  const OPENING_TAG_LENGTH = '<pasted_content id="abcd">'.length;
  const CLOSING_TAG_LENGTH = '</pasted_content id="abcd">'.length;
  const closings = new Map<string, number[]>();
  lines.forEach((line, i) => {
    work.lines += 1;
    const id = CLOSING_TAG.exec(line.slice(0, CLOSING_TAG_LENGTH))?.[1];
    if (id === undefined) return;
    const ends = closings.get(id);
    if (ends === undefined) closings.set(id, [i]);
    else ends.push(i);
  });
  const passed = new Map<string, number>();
  const pasted = lines.map(() => false);
  for (let i = 0; i < lines.length; ) {
    work.lines += 1;
    const id = OPENING_TAG.exec(lines[i]!.slice(-OPENING_TAG_LENGTH))?.[1];
    const ends = id === undefined ? undefined : closings.get(id);
    let k = ends === undefined ? 0 : (passed.get(id!) ?? 0);
    while (ends !== undefined && k < ends.length && ends[k]! < i + 2) {
      work.lines += 1;
      k += 1;
    }
    if (ends !== undefined) passed.set(id!, k); // the place kept whether or not a segment closes, so no closing line is passed twice
    if (ends === undefined || k === ends.length) {
      i += 1;
      continue;
    }
    const end = ends[k]!;
    for (let line = i; line <= end; line += 1) {
      work.lines += 1;
      pasted[line] = true;
    }
    i = end;
  }
  return pasted;
}

/** A person's message's content: a text, or its blocks. */
export type PersonsContent = string | ContentBlock[];

/**
 * A person's content with MAWS's answer envelopes taken out: the one reading of a person's message (ticket 704; the
 * Decision Log's ruling of 2026-11-16), which the split reads it through (`personsParts`, persons-message.ts). No grant
 * reader reads through it: rule R reads the whole joined text (`personsLines`). Each text block by itself (decision 7):
 * an envelope spread over two blocks is not read, since the writer makes one text; a block left empty goes, every
 * other block stays, in place and unchanged. Each text is
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
const readOut = (text: string) => takeEnvelopesOut(text, (own) => envelopeSlices(own, askSteerOpening, pastedBodies, parseAskSteer, MAX_ENVELOPE_CHECKS));

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
// 17), its summary the envelope's own text, as a lone envelope's is; then the grants rule R reads in the WHOLE joined
// text of the message (`personsGrants`, the one reader of grants on every route; ticket 704, the architect's ruling 1 of
// 2026-11-16): which words the split draws as the person's decides no grant.
function personsText(content: PersonsContent): Arrival[] {
  const answers = readPersonsContent(content).envelopes.map(({ text: summary, read }): Answer => ({ class: 'answer', tool: 'maws', call: read.askId, summary, answers: read.result.answers, dismissed: false }));
  return [...answers, ...personsGrants(typeof content === 'string' ? content : messageText(content))];
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

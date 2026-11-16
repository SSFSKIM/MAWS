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
import { askSteerOpening, parseAskSteer } from '../maws/ask';
import { keptLines, type ReadingWork } from '../maws/ask-strict';
import { holdsGrantForm } from './composed-forms';
import { stripAnsi } from '../wire/ansi';
import type { Arrival } from './arrival-schema';
import { askAnswers, DISMISSED } from './ask-delivery';
import { INTERRUPT_MARKER, localCommandParts } from './engine-markers';
import { GRANT_OPENING } from './grant';
import { handbackReport, messageText, parsePeerMessage, peerEventsOf, sminosFrameAlias, sminosFrameOwners, sminosFrameSender, sminosParts } from './peer-envelope';
import { BRIDGE_PLUGINS, BRIDGE_WAKE_LINE, deliveredPrompts, deliveredText, firstLine, isBridgeWake, markedSteerWords, STEER_LINE } from './sminos-delivery';
import { notificationText, taskNotificationBlocks } from './task-notification';

export { ArrivalEntrySchema, CarriedArrivalSchema, carriedOf, type Arrival, type ArrivalEntry, type CarriedArrival } from './arrival-schema';

type Json = Record<string, unknown>;
type Answer = Extract<Arrival, { class: 'answer' }>;
type Task = Extract<Arrival, { class: 'task' }>;
type Own = Extract<Arrival, { class: 'own' }>;
type Peer = Extract<Arrival, { class: 'peer' }>;

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

/** MAWS's own answer envelope read from a message's text alone, for a message still waiting in MAWS's queue. */
export function readAnswerEnvelope(text: string): Answer | null {
  const steer = parseAskSteer(text);
  return steer === null ? null : { class: 'answer', tool: 'maws', call: steer.askId, summary: text, answers: steer.result.answers, dismissed: false };
}

type AskSteer = NonNullable<ReturnType<typeof parseAskSteer>>;
const TAG_OPENS = '[MAWS ask ';
const TAGGED_ID = /^\[MAWS ask ([^\]\s]+)\] /; // the tag's id as `parseAskSteer` reads it

// A line that opens an envelope: the whole first line `askSteerText` writes, built by the writer's own function. A line
// that only begins with the tag (the model's question, header and labels are written verbatim) opens nothing.
function opensEnvelope(line: string): boolean {
  const id = TAGGED_ID.exec(line)?.[1];
  return id !== undefined && line === askSteerOpening(id);
}

/**
 * MAWS's answer envelopes inside a user text the engine may have joined from several waiting messages (members in order,
 * one newline between, under the last one's uuid; U4a's decision 32 c), and the rest of the text (the UX wave, U4b: the
 * Decision Log's line on the architect's medium review, form (b), and on the architect's review of the joined answer).
 * An envelope opens at the writer's whole first line (`askSteerOpening`), and is the shortest slice from there that
 * `parseAskSteer` reads whole and that ends the text or a line, before the next such line: shortest and bounded, so a
 * later member is never swallowed. A line that opens nothing stays text, as does an opening whose slices never parse.
 * A pasted segment's body is data: none of its lines opens or ends an envelope, so an envelope pasted as a log stays in
 * its segment, whole. The rest is the other members, the newline that separated each envelope gone; a text that is all
 * envelope has an empty rest. A text that would cost more than `MAX_ENVELOPE_CHECKS` whole-slice checks is left whole:
 * no envelope, the rest the text unchanged, so every reader sees one ordinary text. The transcript (its row text, the
 * answers it records, the rows it hides) and the recall all read here, so they agree.
 */
export function readAnswerEnvelopes(text: string): { envelopes: AskSteer[]; rest: string } {
  const { envelopes, rest } = readAnswerEnvelopesWithCost(text);
  return { envelopes, rest };
}

/**
 * The most whole-slice checks (`parseAskSteer` on a candidate slice, each one a join and a scan of it) one text may
 * cost. A writer-made envelope costs one, its result block's close being its only line that ends in a fence, and a
 * joined message holds one envelope per answer waiting at a turn's end; so the reader's work on a text stays within
 * this many slices of it (the architect's ruling of 2026-11-16).
 */
export const MAX_ENVELOPE_CHECKS = 64;

/**
 * What one reading of `readAnswerEnvelopes` cost: its whole-slice checks, and the steps of marking the pasted lines
 * (rule R's `pastedBodies`, the one definition of a pasted segment's lines, linear in the lines; the architect's ruling
 * 3865, in place of the pattern's own search, which was not linear on opening tags that never close).
 */
export interface EnvelopeReadingCost {
  checks: number;
  markingSteps: number;
}

/** `readAnswerEnvelopes`, with what the reading cost, for the tests that pin its bounds. */
export function readAnswerEnvelopesWithCost(text: string): { envelopes: AskSteer[]; rest: string; cost: EnvelopeReadingCost } {
  const cost: EnvelopeReadingCost = { checks: 0, markingSteps: 0 };
  const whole = { envelopes: [], rest: text, cost };
  if (!text.includes(TAG_OPENS)) return whole; // read on every user text the transcript draws
  const lines = text.split('\n');
  const marking: ReadingWork = { lines: 0, blockCharacters: 0, formSteps: 0 };
  const pasted = pastedBodies(lines, marking);
  cost.markingSteps = marking.lines;
  const envelopes: AskSteer[] = [];
  const kept: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const end = !pasted[i] && opensEnvelope(lines[i]!) ? envelopeEnd(lines, pasted, i, cost) : null;
    if (end === OVER_CAP) return whole;
    if (end === null) {
      kept.push(lines[i]!);
      i += 1;
      continue;
    }
    envelopes.push(end.steer);
    i = end.next;
  }
  return { envelopes, rest: kept.join('\n'), cost };
}

const OVER_CAP = 'over cap';

// The shortest run of lines from `start` that reads whole as an envelope, and the line after it; null where none does,
// and `OVER_CAP` where finding it would take a check past the text's cap. A run ends before the next opening line:
// `parseAskSteer` pairs the first tag with the last result block, so a malformed member would otherwise run over the
// words and the envelope after it (the joined answer's task review).
function envelopeEnd(lines: readonly string[], pasted: readonly boolean[], start: number, cost: EnvelopeReadingCost): { steer: AskSteer; next: number } | null | typeof OVER_CAP {
  for (let last = start; last < lines.length; last++) {
    if (pasted[last]) continue; // a slice may hold a pasted segment whole, never end inside one
    if (last > start && opensEnvelope(lines[last]!)) return null;
    if (!lines[last]!.endsWith('```')) continue; // the result block's close ends every envelope
    if (cost.checks === MAX_ENVELOPE_CHECKS) return OVER_CAP;
    cost.checks += 1;
    const steer = parseAskSteer(lines.slice(start, last + 1).join('\n'));
    if (steer !== null) return { steer, next: last + 1 };
  }
  return null;
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
 *  1b. A message whose joined text holds a form MAWS composes around words a model, a command or a page wrote (the list
 *     in composed-forms.ts, the forms it flags for grants) yields no grant. The forms are looked for with every line
 *     that reads as a whole sentence set aside, the one test L1 uses below (the architect's ruling 3865).
 *  1. This build's envelopes are taken out strictly, in one forward pass with no pasted-segment logic
 *     (`takeOutEnvelopes`, maws/ask-strict.ts); an opening line that does not read strictly yields no grant.
 *  2. What is left fails closed: an envelope's tag anywhere in it, or a line that opens a json fence, yields no grant,
 *     inside a pasted segment too. L1: a line that reads as a whole sentence keeps its tag. Its subjects are JSON strings
 *     between the sentence's fixed head and tail, one line, so the tag there is a quoted command's and no envelope's
 *     line can stand inside it.
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
 * yields nothing; and a reading that ends earlier, at a
 * block the model forged in a question, leaves the real fence line after it, and step 2 then yields nothing. Pasted
 * segments are read only in step 3, on a text that holds no envelope's line, so a pasted tag cannot hide one.
 *
 * Linear in the text: each line is looked at a bounded number of times (set aside or not once, the take-out once, its
 * sentence read once, the check of what is left once, the pasted segments' two passes on the text and two on what is left, the reading once), each block is
 * parsed once, each composed form's reader is a native pass or two over the text, and every test of a line is
 * anchored with no nested repetition. `work` counts it where it is done (arrival.test.ts pins the counts).
 */
export function personsLines(text: string, work: ReadingWork = { lines: 0, blockCharacters: 0, formSteps: 0 }): { line: string; grants: Consent[] }[] | null {
  const whole = readConsents(text);
  if (whole.length > 0) return [{ line: text, grants: whole }];
  if (!text.includes('\n') || !text.includes(GRANT_OPENING)) return null;
  const all = text.split('\n');
  const aside = all.filter((line) => {
    work.lines += 1;
    return readConsents(line).length === 0;
  });
  const formWork = { steps: 0 };
  const composed = holdsGrantForm(aside.join('\n'), formWork);
  work.formSteps += formWork.steps;
  if (composed) return null;
  const kept = keptLines(all, work);
  if (kept === null) return null;
  const left = kept.map((i) => all[i]!);
  const sentences = left.map((line) => {
    work.lines += 1;
    return readConsents(line);
  });
  for (let i = 0; i < left.length; i += 1) {
    work.lines += 1;
    const line = left[i]!;
    if (line.startsWith('```json') || (line.includes(TAG_OPENS) && sentences[i]!.length === 0)) return null;
  }
  // a line inside a segment of the text as it came, or of what is left (R-2: the take-out can free a line from one, or
  // pair an opening tag with another closing tag): either marking only adds skips
  const asCame = pastedBodies(all, work);
  const asLeft = pastedBodies(left, work);
  const lines = left.map((line, i) => {
    work.lines += 1;
    return { line, grants: asCame[kept[i]!] || asLeft[i] ? [] : sentences[i]! };
  });
  return lines.some((line) => line.grants.length > 0) ? lines : null;
}

// Which lines are inside a pasted segment, as `PASTED_BLOCK` finds segments (the terminal's frame, as the transcript's
// `splitPastedSegments` reads it): from a line that ends with an opening tag to the first line, at least two after it,
// that begins with the closing tag of the same id, both marked; the next segment is looked for from that line. Linear:
// every line is looked at once in each of the two passes, and each closing line once more as a segment passes it.
// The one definition: the envelope slicer marks its pasted lines with it too (`readAnswerEnvelopesWithCost`).
const OPENING_TAG = /^<pasted_content id="([0-9a-f]{4})">$/;
const CLOSING_TAG = /^<\/pasted_content id="([0-9a-f]{4})">$/;
const OPENING_TAG_LENGTH = '<pasted_content id="abcd">'.length;
const CLOSING_TAG_LENGTH = '</pasted_content id="abcd">'.length;
function pastedBodies(lines: readonly string[], work: ReadingWork): boolean[] {
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
  return personsText(text);
}

// MAWS's answer envelope is read on the whole text; a text that is one is never a grant, nor are its lines (U1c).
function personsText(text: string): Arrival[] {
  const answer = readAnswerEnvelope(text);
  return answer === null ? personsGrants(text) : [answer];
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
      return { arrivals: typeof row.content === 'string' ? commandOfText(row.content, undefined) : [], open };
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
  if (parts === null) return [];
  const run = object(row.local_command_run);
  const command = string(run?.command);
  return [{ class: 'command', run: command === null ? null : { command, args: string(run?.args) ?? '' }, stdout: stripAnsi(parts.stdout), stderr: stripAnsi(parts.stderr) }];
}

/** A `user` frame or row, or a terminal's `system` row, whose whole text is a command's output tags; never the person's own text. */
function commandOfText(text: string, originKind: unknown): Arrival[] {
  if (originKind === 'human') return [];
  const parts = localCommandParts(text);
  return parts === null ? [] : [{ class: 'command', run: null, stdout: stripAnsi(parts.stdout), stderr: stripAnsi(parts.stderr) }];
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

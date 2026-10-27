// The grade of a by-effect command, read from its input (O10 M5; RL §5.5, "including indirect paths"; P5 Decision Logs 36
// and 43). One row for every by-effect command of the composed registry, a rule or an explicit `no-rule`
// (test/endpoint/by-effect.test.ts fails when the registry gains a by-effect name this table lacks), and lane A's
// `sminos.command`, graded as the slash command it runs. A rule answers the grade its input's effect takes; the endpoint
// holds it to the command's floor where the two are both session ranks. `no-rule` is refused remotely (`no-rule`) until
// someone reads what the command does for a remote caller.
//
// Words are graded by their slash command (RL §5.5): text that doesn't start with `/` takes `converse`, as do the
// session-only `/model`, `/effort`, `/fast` and the read-only `/cost`, `/context`, `/status`, `/help`; `/compact`,
// `/clear`, `/rewind`, `/resume` and every other command take `manage`. A command is read behind leading whitespace and
// in every text block of a structured message, the highest grade winning, so neither hides one.
import type { Grade, SessionRank } from '@shared/ipc/grades';

export const NO_RULE = 'no-rule';

/** What a rule may read beyond the input: the event that opened a pending broker request (`session.pendingRequest`). */
export type EffectReads = {
  /** The `kind` of the event that opened the request (`question.requested`, `permission.requested`, …), or null when none is pending. */
  pendingKind(appSessionId: string, requestId: string): Promise<string | null>;
};

export type EffectRule = (input: Readonly<Record<string, unknown>>, reads: EffectReads) => Grade | typeof NO_RULE | Promise<Grade | typeof NO_RULE>;

/** Slash commands that change only this session's model or effort, or only read: `converse` (RL §5.5). */
const CONVERSE_COMMANDS: ReadonlySet<string> = new Set(['model', 'effort', 'fast', 'cost', 'context', 'status', 'help']);

/** A slash command's grade by its name (`model`, or `/model`): `converse` for the session-only and read-only ones, else `manage`. */
export function slashGrade(name: string): SessionRank {
  const bare = name.replace(/^\//, '').split(/\s/, 1)[0];
  return CONVERSE_COMMANDS.has(bare) ? 'converse' : 'manage';
}

function textOf(text: string): SessionRank {
  const trimmed = text.trimStart();
  return trimmed.startsWith('/') ? slashGrade(trimmed.slice(1)) : 'converse';
}

/** The grade of a message's content (a string, or content blocks): the highest of its text blocks'. */
export function textGrade(content: unknown): SessionRank {
  if (typeof content === 'string') return textOf(content);
  if (!Array.isArray(content)) return 'manage';
  let grade: SessionRank = 'converse';
  for (const block of content) {
    const text = (block as { type?: unknown; text?: unknown } | null)?.type === 'text' ? (block as { text?: unknown }).text : undefined;
    if (typeof text === 'string' && textOf(text) === 'manage') grade = 'manage';
  }
  return grade;
}

const words: EffectRule = (input) => textGrade(input.content);

/** Event kinds whose answer only says something back: a question, or a MAWS ask (E1 M4b). Every other request executes. */
export const QUESTION_REQUESTS: ReadonlySet<string> = new Set(['question.requested', 'maws.ask.opened']);

/** An answer takes the pending request's grade: a question `converse`; a permission, plan, dialog or elicitation `approve`. */
const answer: EffectRule = async (input, reads) => {
  const kind = (input.answer as { kind?: unknown } | undefined)?.kind;
  if (kind !== 'question') return 'approve';
  const pending = await reads.pendingKind(input.appSessionId as string, input.requestId as string);
  return pending === null || QUESTION_REQUESTS.has(pending) ? 'converse' : 'approve';
};

/** A resume under the stored spec, or one that overrides only its model or effort: `converse` (P5 Decision Log 36). */
const acquire: EffectRule = (input) => {
  const options = input.options;
  if (options === undefined) return 'converse';
  if (typeof options !== 'object' || options === null) return 'manage';
  return Object.keys(options).every((key) => key === 'model' || key === 'effort') ? 'converse' : 'manage';
};

export const BY_EFFECT: Readonly<Record<string, EffectRule | typeof NO_RULE>> = {
  'session.send': words,
  'session.steer': words,
  'session.queue.edit': words,
  'side.sendToMain': words,
  // A release: the queue can change between this read and the host's release, and no fence binds them, so it takes
  // what any entry could (a content fence in the host would let it take its entries' grade: debt).
  'session.queue.promote': () => 'manage',
  'session.queue.setPaused': (input) => (input.paused === true ? 'converse' : 'manage'),
  'session.answer': answer,
  'session.acquire': acquire,
  // A project or path file `manage`; the user's own memory, machine-wide, `machine-admin` (P5 Decision Log 36).
  'session.memoryAppend': (input) => ((input.target as { kind?: unknown } | undefined)?.kind === 'user' ? 'machine-admin' : 'manage'),
  // A text-only edit at the floor; a keyed edit's effect (a submission, a shortcut) is unknown until a probe (P5 DL 43).
  'session.ui.promptEdit': (input) => (input.key === undefined ? 'converse' : NO_RULE),
  // Run a plugin callback the caller names: O7 adds rules for what it uses.
  'session.ui.press': NO_RULE,
  'session.ui.input': NO_RULE,
  'session.ui.select': NO_RULE,
  'session.applyFlagSettings': NO_RULE,
  // Its reader fields are the owner's own row's until O8 keeps them per member, and it is main-owned until O3.
  'session.update': NO_RULE,
  // Lane A: the slash command the bridge runs.
  'sminos.command': (input) => (typeof input.name === 'string' ? slashGrade(input.name) : 'manage'),
};

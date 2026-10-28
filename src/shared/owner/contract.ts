// The to-human contract (X18; the P2-C document, Design §1): the versioned instructions that let MAWS read a session's
// messages to its human, appended to the engine's system prompt with `--append-system-prompt` on a launch whose lane
// wants them (Design §2). The version moves only when the semantics move: a wording change that keeps them keeps the
// number. The prompt-state reader recognises a recorded text by its header line.
//
// P2-C2 (2026-10-13; the P2 spec's Decision Log 31): a style's declaration is read by its shape (`styleShape`), never by
// its number alone, so a later key that keeps the shape needs no MAWS change.
//
// P4-R7z (2026-10-27; the P4 spec's Decision Log 92, reversing Decision Logs 48 to 50 in part): a MAWS session messages
// its human through the to-human plugin's `mcp__to-human__message` alone, under the plugin's style, whose body carries
// the whole message rule (every message through the tool, `final: true` on the one that ends the turn, a `<message>`
// span only where the tool is missing). MAWS has no message tool and no full contract of its own any more: no to-human
// plugin means no to-human lane in MAWS. The lane is on only where the plugin registers its tool, under its own style
// declaring it (6 and up, `carriesPluginMessageTool`) with the plugin's hooks loading (the resolver's `messageTool`), and
// MAWS then appends supplement 3, which says only what MAWS owns, its ask tool; anywhere else the lane is off. MAWS_NATIVE_TO_HUMAN advertises 8, MAWS offering no message tool: the
// plugin registers its tool in a MAWS launch only at 8 or more, and withholds it below. Every MAWS reader takes an
// accepted call of the plugin's tool as a to-human message at the call's place (`message-call.ts`), and of MAWS's former
// tool in a recorded session too. A session recorded under an earlier contract or supplement (1, 5 or 7; 1 or 2), or
// with P4-R7y's alias, keeps what it recorded until the launch decision's "off" lets the prompt render again.
export const CONTRACT_HEADER = (version: number): string => `# Messages to the human (MAWS to-human contract ${version})`;
export const SUPPLEMENT_HEADER = (version: number): string => `# Messages to the human (MAWS to-human supplement ${version})`;

// The front-matter key by which an output style declares the contract version it carries.
export const STYLE_CONTRACT_KEY = 'maws-to-human-contract';

// What a style's declaration says it carries:
// - `marks`: MAWS's own marks; contract 1, and contract 2 (doperpowers 7.147.0: `<message>` the message mark, read by
//   the parser as the to-human kind, and `<essential>` no longer asked for);
// - `message-tool`: `<message>` the one mark, questions asked through a tool (doperpowers 7.148.0 on: contract 3 and 4),
//   and mid-turn messages through one where the style says so (P4-R7: the plugin's 6; MAWS's contracts 5 and 7);
// - `none`: nothing MAWS can read (no key, a value that is no version, an unknown style, a built-in).
export type StyleShape = 'marks' | 'message-tool' | 'none';
export const MARKS_CONTRACTS: readonly number[] = [1, 2];
export const MESSAGE_TOOL_FROM = 3; // the first contract of the message-tool shape; every later one keeps it

export function styleShape(declared: number | null): StyleShape {
  if (declared === null || !Number.isInteger(declared)) return 'none';
  if (MARKS_CONTRACTS.includes(declared)) return 'marks';
  return declared >= MESSAGE_TOOL_FROM ? 'message-tool' : 'none';
}

// P4-R7z: whether a style declares the plugin's message tool, the one a MAWS session messages through: the plugin's
// style from 6, and every later declaration of the shape. A message-tool style before it (3 or 4: questions through a
// tool, messages as spans) came with no such tool. The plugin registers the tool only under its own style, by this name
// (the to-human plugin's rule), and only while the `to-human` plugin's hooks load.
export const PLUGIN_MESSAGE_TOOL_FROM = 6;
export const PLUGIN_STYLE = 'doperpowers:to-human';
export const TO_HUMAN_PLUGIN = 'to-human';
export const carriesPluginMessageTool = (declared: number | null): boolean => declared !== null && styleShape(declared) === 'message-tool' && declared >= PLUGIN_MESSAGE_TOOL_FROM;

// The advertisement (Design §3): set in a launch's settings env, its value the contract version, while the lane is on,
// so a plugin that draws its own to-human view can defer to MAWS. P4-R7z: 8 says MAWS offers no message tool, which the
// plugin reads as its cue to register its own in MAWS's headless launch.
export const NATIVE_TO_HUMAN_ENV = 'MAWS_NATIVE_TO_HUMAN';
export const TO_HUMAN_CONTRACT_VERSION = 8;

export interface ContractText {
  version: number;
  text: string; // opens with its header line
}

const CONTRACT_1: ContractText = {
  version: 1,
  text: `${CONTRACT_HEADER(1)}

The human who runs this session reads a report of it, not the transcript. Your prose, your tool calls and their results stay in the session as your working record, which they open only when they go looking. Only what you mark reaches them, so anything you want them to read, your answers included, goes inside a mark:

- \`<to-human>…</to-human>\`: a message delivered to them, wherever you write it, written as you would write to someone away from the screen.
- \`<essential>…</essential>\`: what they must not miss. It stays in front of them until they mark it read.
- \`<need-input>…</need-input>\`: a question you can wait on while you go on with other work, one question per mark, the question on the mark's first line. Its options, when it has any, go inside the mark under the question, one \`<choice>…</choice>\` line each, with \`<choice recommended>…</choice>\` on the one you would pick. Their answer arrives later as their next message, beginning \`Answering "<the question's first line>":\`. Input you cannot continue without is not a mark: ask for it with AskUserQuestion.
- \`<insight>…</insight>\`: before and after you write code, a brief explanation of two or three implementation choices specific to this codebase. It is shown beside your messages.

For example, a question with two options:

<need-input>Which backend should the board use?
<choice recommended>Postgres: already running for the board</choice>
<choice>SQLite: one file, no daemon</choice>
</need-input>

Write marks as plain text in your reply, never inside code blocks or inline code, where they are shown as code. Say what you mean directly and literally, without metaphor or flourish.`,
};

// When a message is due: the doperpowers style's paragraph whole, contract 5's and contract 7's alike.
const WHEN_TO_SEND = `Send a message when it changes what the human knows or does: the answer to what they asked, a decision or permission only they can give, a blocker or a departure from what they asked, a finding that changes the answer or the plan, and the result when the work ends. A finished step, a passed test, a worker's completion, or what you are about to do next is working record unless one of those applies; what can wait goes into the next message that has to be sent. The request sets the bar: a direct question expects its answer; a long task expects word at those points, and an acknowledgement at the start only if it will run long enough for the human to wonder; anything they did not ask about has to be new to them, consequential, and useful now rather than later. Silence says only that nothing needed sending, so what is unresolved goes in the next message.`;

const ASK_WITH = `Ask for input with \`mcp__maws__ask\`: \`blocking: false\` when you can go on working (their answer arrives later as a user message naming the askId), \`blocking: true\` when your next step needs it. Use the native AskUserQuestion only where \`mcp__maws__ask\` is missing.`;

const LITERALLY = 'Say what you mean literally, without metaphor. Marks are plain text, never in code.';

// Contract 5 (P2-C2, the owner's answer of 2026-10-13 on Decision Log 31: parity with the plugin's style). It follows the
// installed doperpowers `output-styles/to-human.md` paragraph by paragraph in MAWS's words: when a message is due (the
// style's paragraph whole), `<message>` the one mark, questions through MAWS's own ask tool, plain language, marks
// never in code. 5 sits above the plugin's 3 and 4, whose ask tool it does not share. Nothing asks for the four marks of
// contract 1; grammar 2 keeps reading them.
const CONTRACT_5: ContractText = {
  version: 5,
  text: `${CONTRACT_HEADER(5)}

The human reads a report, not the transcript: only what you mark reaches them, so everything you want them to read, your answers included, goes inside \`<message>…</message>\`, one message per span, wherever written.

${WHEN_TO_SEND}

${ASK_WITH}

${LITERALLY}`,
};

// Contract 7 (P4-R7; the P4 spec's Decision Log 46): contract 5 with the message tool. A message sent before another
// tool call goes through `mcp__maws__message`, in the same response as that call, with the reason in a clause so the
// model can carry it to a case the rule does not name; every other message stays a span. 7 sits above the plugin's 6,
// whose message tool it does not share. Its other paragraphs are contract 5's.
const CONTRACT_7: ContractText = {
  version: 7,
  text: `${CONTRACT_HEADER(7)}

The human reads a report, not the transcript: only the messages you send reach them, so everything you want them to read, your answers included, is a message. A message you send before another tool call goes through \`mcp__maws__message\` (its \`text\` the message, in Markdown), called in the same response as that tool call: written as text there, it comes back as a paraphrase that never reaches them. Every other message goes inside \`<message>…</message>\`, one message per span. Where \`mcp__maws__message\` is missing, a span is the only form.

${WHEN_TO_SEND}

${ASK_WITH}

${LITERALLY}`,
};

// Contract 1 (P2-C, 2026-10-09), MAWS's full contract until contract 5; contract 5, until contract 7 (P4-R7); and
// contract 7, until P4-R7z took MAWS's full contract away: still what sessions recorded under them carry, which the
// prompt-state reader recognises and the decision table switches at their next launch.
export const LEGACY_CONTRACT_1: ContractText = CONTRACT_1;
export const LEGACY_CONTRACT_5: ContractText = CONTRACT_5;
export const LEGACY_CONTRACT_7: ContractText = CONTRACT_7;

// The supplement (P2-C2), appended beside the plugin's style. The style names the plugin's own ask tool, which MAWS's
// launch does not register (MAWS_NATIVE_TO_HUMAN keeps it unregistered); MAWS's is there instead. It says only what the
// style cannot know here, so it never restates the style. Supplements 1 and 2 named the ask tool by both names it has
// had: doperpowers' until the ask moved to the sminos plugin (doperpowers' sminos plugin design, §11), sminos's after.
// P4-R7: supplement 2 added the message rule and MAWS's message tool, and said the plugin's was not available here.
// P4-R7z: supplement 3 keeps only what MAWS still owns, its ask tool; the message rule is the plugin style's.
const ASK_HERE = `Ask the human with \`mcp__maws__ask\`: \`blocking: false\` when you can go on with other work while they decide (their answer arrives later as a user message naming the askId), \`blocking: true\` when you need the answer before your next step. Neither \`mcp__sminos__AskUserQuestion\` nor \`mcp__doperpowers__AskUserQuestion\` is available here; use the native AskUserQuestion only where \`mcp__maws__ask\` is missing.`;
const MARKS_PLAIN = 'Write marks as plain text, never inside code blocks or inline code.';

const SUPPLEMENT_1: ContractText = {
  version: 1,
  text: `${SUPPLEMENT_HEADER(1)}

This session runs in MAWS, whose human reads a report of it: only what you mark reaches them, so everything you want them to read, your answers included, goes inside \`<message>…</message>\`, the one mark here too. ${ASK_HERE} ${MARKS_PLAIN}`,
};

const SUPPLEMENT_2: ContractText = {
  version: 2,
  text: `${SUPPLEMENT_HEADER(2)}

This session runs in MAWS, whose human reads a report of it: only the messages you send reach them, so everything you want them to read, your answers included, is a message. A message you send before another tool call goes through \`mcp__maws__message\` (its \`text\` the message, in Markdown), called in the same response as that tool call: written as text there, it comes back as a paraphrase that never reaches them. Every other message goes inside \`<message>…</message>\`, the one mark here too. \`mcp__to-human__message\` is not available here. ${ASK_HERE} ${MARKS_PLAIN}`,
};

const SUPPLEMENT_3: ContractText = {
  version: 3,
  text: `${SUPPLEMENT_HEADER(3)}

This session runs in MAWS. ${ASK_HERE}`,
};

// Supplements 1 and 2, until their successors: what sessions recorded under them carry, which the decision table
// switches at their next launch.
export const LEGACY_SUPPLEMENT_1: ContractText = SUPPLEMENT_1;
export const LEGACY_SUPPLEMENT_2: ContractText = SUPPLEMENT_2;

export const SUPPLEMENT: ContractText = SUPPLEMENT_3;
export const TO_HUMAN_SUPPLEMENT_VERSION = SUPPLEMENT.version;
export const TO_HUMAN_SUPPLEMENT = SUPPLEMENT.text;

// P4-R7y's alias (2026-10-21, the owner's ask; withdrawn by P4-R7z): the text a SessionStart hook gave the model at
// every start of a lane-on session, and P4-A2 appended to the system prompt under hooks off, saying the plugin's message
// tool was MAWS's there. Kept so the prompt-state reader still tells a snapshot that recorded it alone (`alias`) from
// one with none, and the decision table renders that prompt anew.
export const LEGACY_MESSAGE_TOOL_ALIAS = 'In this session `mcp__to-human__message` is the `mcp__maws__message` tool: wherever your instructions name `mcp__to-human__message`, call `mcp__maws__message`, which takes the same input.';

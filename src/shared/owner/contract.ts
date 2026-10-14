// The to-human contract (X18; the P2-C document, Design §1): MAWS's own versioned instructions, appended to the engine's
// system prompt with `--append-system-prompt` on a launch whose lane wants it (Design §2). The version moves only when
// the semantics move: a wording change that keeps them keeps the number. The prompt-state reader recognises a recorded
// contract by its header line. The answer form it names is the doperpowers mod's (`answer.ts`), so answers given in a
// terminal through the mod read the same, and a compatible style needs no new wording.
//
// P2-C2 (2026-10-13; the P2 spec's Decision Log 31): a style's declaration is read by its shape (`styleShape`), never by
// its number alone, so a later key that keeps the shape needs no MAWS change. A style carrying MAWS's marks (1 or 2)
// needs nothing appended; a message-only style whose questions go through a tool (3 or more) gets the short supplement
// below, which names the ask tool a MAWS session has; no declaration gets the full contract.
export const CONTRACT_HEADER = (version: number): string => `# Messages to the human (MAWS to-human contract ${version})`;
export const SUPPLEMENT_HEADER = (version: number): string => `# Messages to the human (MAWS to-human supplement ${version})`;

// The front-matter key by which an output style declares the contract version it carries.
export const STYLE_CONTRACT_KEY = 'maws-to-human-contract';

// What a style's declaration says it carries:
// - `marks`: MAWS's own marks; contract 1, and contract 2 (doperpowers 7.147.0: `<message>` the message mark, read by
//   the parser as the to-human kind, and `<essential>` no longer asked for);
// - `message-tool`: `<message>` the one mark, questions asked through a tool (doperpowers 7.148.0 on: contract 3 and 4);
// - `none`: nothing MAWS can read (no key, a value that is no version, an unknown style, a built-in).
export type StyleShape = 'marks' | 'message-tool' | 'none';
export const MARKS_CONTRACTS: readonly number[] = [1, 2];
export const MESSAGE_TOOL_FROM = 3; // the first contract of the message-tool shape; every later one keeps it

export function styleShape(declared: number | null): StyleShape {
  if (declared === null || !Number.isInteger(declared)) return 'none';
  if (MARKS_CONTRACTS.includes(declared)) return 'marks';
  return declared >= MESSAGE_TOOL_FROM ? 'message-tool' : 'none';
}

// The advertisement (Design §3): set in a launch's settings env, its value the contract version, while the lane is on,
// so a plugin that draws its own to-human view can defer to MAWS.
export const NATIVE_TO_HUMAN_ENV = 'MAWS_NATIVE_TO_HUMAN';

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

// Contract 5 (P2-C2, the owner's answer of 2026-10-13 on Decision Log 31: parity with the plugin's style). It follows the
// installed doperpowers `output-styles/to-human.md` paragraph by paragraph in MAWS's words: when a message is due (the
// style's paragraph whole), `<message>` the one mark, questions through MAWS's own ask tool, plain language, marks
// never in code. 5 sits above the plugin's 3 and 4, whose ask tool it does not share. Nothing asks for the four marks of
// contract 1; grammar 2 keeps reading them.
const CONTRACT_5: ContractText = {
  version: 5,
  text: `${CONTRACT_HEADER(5)}

The human reads a report, not the transcript: only what you mark reaches them, so everything you want them to read, your answers included, goes inside \`<message>…</message>\`, one message per span, wherever written.

Send a message when it changes what the human knows or does: the answer to what they asked, a decision or permission only they can give, a blocker or a departure from what they asked, a finding that changes the answer or the plan, and the result when the work ends. A finished step, a passed test, a worker's completion, or what you are about to do next is working record unless one of those applies; what can wait goes into the next message that has to be sent. The request sets the bar: a direct question expects its answer; a long task expects word at those points, and an acknowledgement at the start only if it will run long enough for the human to wonder; anything they did not ask about has to be new to them, consequential, and useful now rather than later. Silence says only that nothing needed sending, so what is unresolved goes in the next message.

Ask for input with \`mcp__maws__ask\`: \`blocking: false\` when you can go on working (their answer arrives later as a user message naming the askId), \`blocking: true\` when your next step needs it. Use the native AskUserQuestion only where \`mcp__maws__ask\` is missing.

Say what you mean literally, without metaphor. Marks are plain text, never in code.`,
};

// Contract 1 (P2-C, 2026-10-09), MAWS's full contract until contract 5: still what sessions recorded under it carry, which
// the prompt-state reader recognises and the decision table switches at their next launch.
export const LEGACY_CONTRACT_1: ContractText = CONTRACT_1;

// The full contract MAWS appends where no style carries the channel: the one constant the owner's answer to Decision
// Log 31's question swapped (2026-10-13: yes, parity with the plugin's message-tool shape).
export const FULL_CONTRACT: ContractText = CONTRACT_5;
export const TO_HUMAN_CONTRACT_VERSION = FULL_CONTRACT.version;
export const TO_HUMAN_CONTRACT = FULL_CONTRACT.text;

// A style declaring exactly MAWS's own full contract already says everything the supplement would: nothing is appended.
export const carriesFullContract = (declared: number | null): boolean => declared === FULL_CONTRACT.version;

// The supplement (P2-C2), appended beside a message-tool style. Such a style names the plugin's own ask tool, which a
// headless (`-p`) launch, MAWS's, does not register; MAWS's `ask` tool is there instead. It says only what the style
// cannot know here, so it never restates the style.
export const TO_HUMAN_SUPPLEMENT_VERSION = 1;
export const TO_HUMAN_SUPPLEMENT = `${SUPPLEMENT_HEADER(TO_HUMAN_SUPPLEMENT_VERSION)}

This session runs in MAWS, which delivers your messages and questions to the human. \`<message>…</message>\` is the one mark here too. Ask the human with \`mcp__maws__ask\`: \`blocking: false\` when you can go on with other work while they decide (their answer arrives later as a user message naming the askId), \`blocking: true\` when you need the answer before your next step. \`mcp__doperpowers__AskUserQuestion\` is not available here; use the native AskUserQuestion only where \`mcp__maws__ask\` is missing. Write marks as plain text, never inside code blocks or inline code.`;

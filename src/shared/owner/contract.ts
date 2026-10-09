// The to-human contract (X18; the P2-C document, Design §1): MAWS's own versioned instructions, appended to the engine's
// system prompt with `--append-system-prompt` on a launch whose lane wants it (Design §2). The version moves only when
// the semantics move: a wording change that keeps them keeps the number. The prompt-state reader recognises a recorded
// contract by its header line. The answer form it names is the doperpowers mod's (`answer.ts`), so answers given in a
// terminal through the mod read the same, and a compatible style needs no new wording.
export const TO_HUMAN_CONTRACT_VERSION = 1;

export const CONTRACT_HEADER = (version: number): string => `# Messages to the human (MAWS to-human contract ${version})`;

// Every contract version MAWS can present: a style declaring one of them in its front matter needs no appended contract.
export const COMPATIBLE_CONTRACTS: readonly number[] = [1];

// The front-matter key by which an output style declares the contract version it carries.
export const STYLE_CONTRACT_KEY = 'maws-to-human-contract';

// The advertisement (Design §3): set in a launch's settings env, its value the contract version, while the lane is on,
// so a plugin that draws its own to-human view can defer to MAWS.
export const NATIVE_TO_HUMAN_ENV = 'MAWS_NATIVE_TO_HUMAN';

export const TO_HUMAN_CONTRACT = `${CONTRACT_HEADER(TO_HUMAN_CONTRACT_VERSION)}

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

Write marks as plain text in your reply, never inside code blocks or inline code, where they are shown as code. Say what you mean directly and literally, without metaphor or flourish.`;

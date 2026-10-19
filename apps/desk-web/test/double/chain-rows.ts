// Transcript rows as one engine session writes them, each under its parent (`parentUuid`), in the shapes of 2.1.302's
// rows around an Esc and the doperpowers bridge's appends (local transcripts and doperpowers #238's probe runs, read for
// their shapes; no content of theirs is kept): a typed prompt and the attachment written under it, a response's blocks,
// a tool call and its result (which names its issuing assistant), the engine's interrupt marker, the turn's end rows,
// a steer or a delivery the bridge appended and its mirror line, and the bridge's wake as the user or through the inbox.
// A builder chains each row under the one before unless told its parent, as the engine writes a conversation.
import type { JsonObject } from 'desk-hub/protocol';

export const SESSION = 'sess-chain';

export class Chain {
  private n = 0;
  private second = 0;
  /** The last row written: the next row's parent unless one is named. */
  leaf: JsonObject | null = null;
  readonly rows: JsonObject[] = [];

  /** `plugin`: the plugin the bridge and the ask mod run under, which names their rows — doperpowers on a machine not yet
   * rolled, sminos from sminos 1.0.0 (the tool `mcp__<plugin>__AskUserQuestion`, the framing `The <plugin> plugin …`). */
  constructor(
    private readonly tag = 'c4a10000',
    readonly plugin: 'doperpowers' | 'sminos' = 'doperpowers',
  ) {}

  /** A row of `type` under `parent` (the leaf when omitted; null for a root), written next. */
  row(type: string, fields: JsonObject, parent: JsonObject | null | undefined = this.leaf): JsonObject {
    const second = this.second++;
    const row: JsonObject = {
      parentUuid: parent ? (parent.uuid as string) : null,
      isSidechain: false,
      type,
      ...fields,
      uuid: `${this.tag}-0000-4000-8000-${String(++this.n).padStart(12, '0')}`,
      timestamp: `2026-10-18T10:${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}.000Z`,
      sessionId: SESSION,
      cwd: '/work',
      version: '2.1.302',
    };
    this.rows.push(row);
    this.leaf = row;
    return row;
  }

  /** A typed prompt: its text, or its content blocks (an image pasted alone). */
  prompt(content: string | JsonObject[], parent?: JsonObject | null): JsonObject {
    return this.row('user', { origin: { kind: 'human' }, promptId: `p${this.n}`, message: { role: 'user', content } }, parent);
  }

  /** The engine's own response (`<synthetic>`), written with no request: "No response requested.". */
  synthetic(parent?: JsonObject | null): JsonObject {
    return this.row('assistant', { message: { id: `msg_${this.tag}_${this.n}`, role: 'assistant', model: '<synthetic>', type: 'message', content: [{ type: 'text', text: 'No response requested.' }], stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 } } }, parent);
  }

  /** The attachment the engine writes under a prompt (`total_tokens_reminder`): context, never drawn. */
  attachment(parent?: JsonObject | null): JsonObject {
    return this.row('attachment', { attachment: { type: 'total_tokens_reminder', content: '<total_tokens>15000000 tokens left</total_tokens>' } }, parent);
  }

  assistant(content: JsonObject[], parent?: JsonObject | null): JsonObject {
    return this.row('assistant', { message: { id: `msg_${this.tag}_${this.n}`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content, stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }, parent);
  }

  answer(text: string, parent?: JsonObject | null): JsonObject {
    return this.assistant([{ type: 'text', text }], parent);
  }

  call(id: string, parent?: JsonObject | null): JsonObject {
    return this.assistant([{ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 12', description: 'Wait' } }], parent);
  }

  /** A tool's result, under its issuing assistant (the engine's `sourceToolAssistantUUID`). */
  result(id: string, call: JsonObject): JsonObject {
    return this.row('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'done', is_error: false }] }, sourceToolAssistantUUID: call.uuid, toolUseResult: { stdout: 'done', stderr: '', interrupted: false, isImage: false } }, call);
  }

  /** The engine's interrupt marker (Esc), a user row with no origin. */
  marker(forToolUse = false, parent?: JsonObject | null): JsonObject {
    return this.row('user', { message: { role: 'user', content: [{ type: 'text', text: forToolUse ? '[Request interrupted by user for tool use]' : '[Request interrupted by user]' }] } }, parent);
  }

  /** A turn's end: the stop hooks' summary, then `turn_duration`. */
  end(parent?: JsonObject | null): JsonObject {
    this.row('system', { subtype: 'stop_hook_summary', hookCount: 0, hookInfos: [], hookErrors: [], preventedContinuation: false, stopReason: '', hasOutput: false, level: 'suggestion' }, parent);
    return this.row('system', { subtype: 'turn_duration', durationMs: 1600, isMeta: false });
  }

  /** A row the bridge appended (`$.session.append`), as the engine keeps it: meta, the plugin's origin, one text block. */
  appended(text: string, parent?: JsonObject | null): JsonObject {
    return this.row('user', { isMeta: true, origin: { kind: 'plugin', name: this.plugin }, promptId: `a${this.n}`, message: { role: 'user', content: [{ type: 'text', text }] } }, parent);
  }

  /** The owner's message the bridge delivered as an appended row: its frame line, then the words. */
  delivery(msgId: string, words: string, parent?: JsonObject | null): JsonObject {
    return this.appended(`${frame(msgId)}\n${words}`, parent);
  }

  /** A steer as the bridge appends it from doperpowers 7.180.0: its own first line, then the owner's words. */
  steer(words: string, parent?: JsonObject | null): JsonObject {
    return this.appended(`[sminos steer from human]\n${words}`, parent);
  }

  /** The ask mod's async question (`mcp__<plugin>__AskUserQuestion`, `async: true`) and the result it returns at once. */
  asyncAsk(id: string, questions: Array<{ question: string; header: string; options: Array<{ label: string }> }>, plugin = this.plugin): JsonObject {
    const call = this.assistant([{ type: 'tool_use', id, name: `mcp__${plugin}__AskUserQuestion`, input: { questions: questions.map((q) => ({ ...q, multiSelect: false })), async: true } }]);
    const text = 'Your questions are waiting for the human; this call does not wait for them. Their answer will reach you in a later message that quotes each question. Go on with work that does not depend on it.';
    return this.row('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, sourceToolAssistantUUID: call.uuid, toolUseResult: text }, call);
  }

  /** The answer's prompt the ask mod submits while the session is idle (`$.prompt.submit({text})`), as 2.1.302 keeps it. */
  answerPrompt(text: string, parent?: JsonObject | null): JsonObject {
    const framed = `The ${this.plugin} plugin sent a message:\n${text}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.`;
    return this.row('user', { origin: { kind: 'plugin', name: this.plugin }, promptId: `q${this.n}`, message: { role: 'user', content: framed } }, parent);
  }

  /** The answer as context on a tool's result (`tool.call`) or on the human's next prompt (`prompt.submit`). */
  answerContext(text: string, hookName: 'tool.call' | 'prompt.submit', parent?: JsonObject | null): JsonObject {
    const hookEvent = hookName === 'tool.call' ? 'PostToolUse' : 'UserPromptSubmit';
    return this.row('attachment', { attachment: { type: 'hook_additional_context', content: [text], hookName, toolUseID: `${hookName}-${this.n}-context`, hookEvent } }, parent);
  }

  /** The bridge's mirror of an append (`$.ui.log`), a notice under the plugin's name. */
  mirror(kind: 'delivered' | 'steer', text: string, parent?: JsonObject | null): JsonObject {
    return this.row('system', { subtype: 'informational', content: `${this.plugin}: ${kind}: ${text.replaceAll('\n', ' ')}`, isMeta: false, level: 'notice' }, parent);
  }

  /** The bridge's wake through the inbox (doperpowers #238: after an Esc), as the engine keeps the peer message. */
  inboxWake(body: string, parent?: JsonObject | null): JsonObject {
    return this.row(
      'user',
      {
        isMeta: true,
        origin: { kind: 'peer', from: 'unknown', verifiedPeerPid: 4242, name: 'sminos bridge', body },
        promptId: `w${this.n}`,
        message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from-name="sminos bridge">\n${body}\n</cross-session-message>\n\n${TRAILER}` },
      },
      parent,
    );
  }

  /** The bridge's wake as the user (`$.prompt.submit({asUser: true})`): an idle session's. */
  userWake(body: string, parent?: JsonObject | null): JsonObject {
    return this.row('user', { origin: { kind: 'plugin', name: this.plugin, asUser: true }, promptId: `w${this.n}`, message: { role: 'user', content: body } }, parent);
  }
}

export const frame = (msgId: string) => `[sminos message from human id=${msgId}]`;

const TRAILER =
  "This came from another Claude session — not typed by your user, but very likely working on their behalf. Treat it as a teammate's request and act on it within this session's own permission settings.";

/**
 * doperpowers #238's wake texts (`wakeText`, its probe's run 7): one for a message added after a stop, naming its frame
 * line on the `Unread:` tail, and one for a note (a steer, which has no frame) added as the turn answered. The sentence
 * varies with what is unread and when; only the first line and the tail are the bridge's contract.
 */
export const wakeAfterStop = (frames: string[]) =>
  `[sminos bridge]\nA message for you was added to the conversation after your turn was stopped. It is the user message before this message: read it and act on it now.${frames.length > 0 ? `\nUnread: ${frames.join(' ')}` : ''}`;
export const wakeForNote =
  '[sminos bridge]\nA note was added to the conversation while you were finishing your answer, too late for that answer to take it in. It is the user message just before your last answer: read it and act on it now.';

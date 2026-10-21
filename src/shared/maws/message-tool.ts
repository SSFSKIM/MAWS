// P4-R7 (the P4 spec's Decision Log 46; the cross-repo contract of doperpowers' to-human message tool spec): the `maws`
// server's `message`, which the engine exposes as `mcp__maws__message`. A message the model sends before another tool
// call goes through it, because text written there comes back from the API as a progress-update thinking block, a
// paraphrase the human never sees, while a tool's input is never summarized. Input `{text}`, the message in Markdown;
// result `sent`, the to-human plugin's result for its tool of the same shape; refused only when there is no text. Every
// MAWS reader takes an accepted call as a to-human message at its place (`../owner/message-call`), and only this tool's.
// It is always loaded (`_meta["anthropic/alwaysLoad"]`, which the pinned engine honours for an SDK server's tool,
// P4-B4's probe): under tool search a deferred tool would cost a ToolSearch before the first message. `./tools`
// appends the name and entry after the search tool (its P4-R7 blocks); this file imports only zod, so the two never
// import each other. The owner's skills target these names and shapes: they change only by a dated line.
import * as z from 'zod';

export const MESSAGE_TOOL_NAMES = ['message'] as const;
export type MessageToolName = (typeof MESSAGE_TOOL_NAMES)[number];

export const MessageInputSchema = z.strictObject({
  text: z
    .string()
    .refine((text) => text.trim() !== '', 'the message is empty')
    .describe('The message, in Markdown: what you would write inside <message>…</message>.'),
});
export type MessageInput = z.infer<typeof MessageInputSchema>;

// What an accepted call answers: the plugin's result, word for word, so the two tools read alike.
export const MESSAGE_SENT = 'sent';

// The key the engine reads off a listed tool to load it whatever tool search defers.
export const ALWAYS_LOAD = { 'anthropic/alwaysLoad': true } as const;

export const MESSAGE_TOOLS = {
  message: {
    title: 'Send message',
    description:
      "Send the user a message now, word for word, shown in the session's report in MAWS where this call sits; without this tool, write the message inside <message>…</message>. Use it for a message you send before another tool call, called in the same response as that call: text written there comes back as a paraphrase that never reaches the user. A message at the end of your turn stays a <message> span.",
    input: MessageInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
    meta: ALWAYS_LOAD,
  },
} as const satisfies Record<MessageToolName, { title: string; description: string; input: z.ZodType; annotations: { readOnlyHint: boolean; openWorldHint: boolean }; meta: Record<string, unknown> }>;

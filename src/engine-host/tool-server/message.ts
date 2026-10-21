// `message` (P4-R7; the P4 spec's Decision Log 46): the model's message to the human, sent before another tool call. The
// message is the call itself: its input lands in the transcript word for word, where every reader takes an accepted
// call as a to-human message at its place (`@shared/owner/message-call`), so the host keeps nothing and answers `sent`,
// the plugin's result, at once. Only a call with no text is refused (the cross-repo contract: sminos's export logs an
// accepted call, so a refusal is kept for a message that was not sent). A subagent's call is sent too: its row draws in
// the subagent's transcript, where its spans draw.
import { MESSAGE_SENT } from '@shared/maws/message-tool';
import { parseToolArguments } from '@shared/maws/tools';
import { defineMawsTool, toolError, type McpToolDefinition } from './server';

export function messageTool(): McpToolDefinition {
  return defineMawsTool('message', async (args) => {
    const parsed = parseToolArguments('message', args);
    if (!parsed.ok) return toolError(parsed.error);
    return { content: [{ type: 'text', text: MESSAGE_SENT }] };
  });
}

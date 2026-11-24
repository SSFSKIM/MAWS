// The direct tell's engine half (the charter's Decision Log, 2026-11-24; src/shared/maws/tell.ts): the text to one of the
// session's agents through the built-in mod's tool, by a checked `mcp_call`, with no model turn. The engine answers the
// call with an error whatever the hook answered, so the answer is read by its words (`readTellAnswer`); an answer that
// is neither the delivery nor the mod's refusal (the session's mode refuses the call, the mod is not loaded) is thrown
// as the engine gave it. The mod allows the host's own call at `tool.check`, so no permission request comes of it.
import { readTellAnswer, TELL_AGENT_ID, TELL_TOOL, tellText, type TellAnswer } from '@shared/maws/tell';
import { mcpCall } from './controls';
import { ControlCancelled, ControlError, ControlTimeout, type ControlClient } from './rpc';

export async function tellAgent(client: ControlClient, agentId: string, text: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<TellAnswer> {
  if (!TELL_AGENT_ID.test(agentId)) return { delivered: false, reason: `${agentId} is not the id of an agent of this session` };
  let answer: Awaited<ReturnType<typeof mcpCall>>;
  try {
    answer = await mcpCall(client, { tool: TELL_TOOL, arguments: { agent: agentId, text: tellText(text) }, check_permissions: true }, opts);
  } catch (error) {
    if (!(error instanceof ControlError) || error instanceof ControlTimeout || error instanceof ControlCancelled) throw error;
    const read = readTellAnswer(error.message);
    if (read === null) throw error;
    return read;
  }
  // an engine that hands the hook's own result back: the mod's word for a delivery, else nothing this call can vouch for
  const content = answer.content;
  const said = typeof content === 'string' ? content : content.map((block) => (block as { text?: unknown }).text).filter((t) => typeof t === 'string').join('');
  if (said === 'delivered') return { delivered: true };
  throw new Error(`the tell's answer was not the mod's: ${said.slice(0, 200)}`);
}

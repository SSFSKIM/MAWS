// MAWS's tell (the charter's Decision Log, 2026-11-24: the host's own channel, not a communication mod). MAWS passes
// this folder with --plugin-dir to every session its engine host runs. The mod registers one tool, `tell`, which
// only the host calls, through the engine's checked mcp_call (spikes/protocol-probe/findings-uxwave-tell-direct.txt):
// - tool.offer hides it from every loop's model, so no model is offered it or can call it;
// - tool.check allows the host's own call, so the host is not asked and dontAsk mode lets it through;
// - tool.run refuses any call that is not the host's, and sends the text to the agent with $.session.send, answering
//   a refusal as TELL_REFUSED and the engine's reason (src/shared/maws/tell.ts reads the answer).
// A plain JavaScript module, so the app's own build and checks leave it as written.
const TOOL = 'mcp__maws-tell__tell';
const HOST_CALL = 'toolu_mcp_call_';
const REFUSED = 'TELL_REFUSED ';
const NOT_HOST = 'TELL_NOT_HOST ';

const fromHost = (id) => typeof id === 'string' && id.startsWith(HOST_CALL);

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    try {
      await $.tool.register({
        name: 'tell',
        description: 'MAWS sends a message the person wrote to one of this session\'s agents.',
        inputSchema: { type: 'object', properties: { agent: { type: 'string' }, text: { type: 'string' } }, required: ['agent', 'text'] },
      });
    } catch (error) {
      $.ui.log(`maws-tell: the tool was not registered: ${String(error)}`, { to: 'debug' });
    }
    return result;
  });
  on('tool.offer', { tool: TOOL }, () => ({ isOffered: false }));
  on('tool.check', { tool: TOOL }, ($, e, next) => (fromHost(e.tool_use_id) ? { decision: 'allow', reason: 'MAWS tells an agent what the person wrote' } : next(e)));
  on('tool.run', { tool: TOOL }, async ($, e) => {
    if (!fromHost(e.tool_use_id)) return { deny: `${NOT_HOST}only MAWS calls this tool` };
    if (typeof e.agent !== 'string' || e.agent === '' || typeof e.text !== 'string' || e.text.trim() === '') return { deny: `${REFUSED}an agent id and the text are needed` };
    const sent = await $.session.send({ to: { agentId: e.agent }, text: e.text });
    return sent.isDelivered ? { result: 'delivered' } : { deny: `${REFUSED}${sent.reason}` };
  });
};

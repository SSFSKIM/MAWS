// P4-R7: `message` on the maws server, as the cross-repo contract has it (the P4 spec's Decision Log 46): an accepted call
// answers `sent` as plain text, word for word the plugin's result, so sminos's export logs it; only a call with no
// message is refused, and a subagent's call is sent like the main conversation's.
import { describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { mawsToolList } from '@shared/maws/tools';
import type { ControlRequestFrame } from '@shared/wire/frames';
import { messageTool } from './message';
import { MawsToolServer } from './server';
import { mawsTools } from './tools';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(fromSubagent = false) {
  const sent: { requestId: RequestId; response: unknown }[] = [];
  const server = new MawsToolServer({
    tools: [messageTool()], appSessionId: 'app-1' as AppSessionId, version: '0.9.0', cwd: () => '/r/repo', log: () => {}, onChange: () => {},
    respond: async (requestId, response) => void sent.push({ requestId, response }), fromSubagent: () => fromSubagent,
  });
  let n = 0;
  const call = async (args: unknown) => {
    const request_id = `req-${++n}`;
    server.accept({ type: 'control_request', request_id, request: { subtype: 'mcp_message', server_name: 'maws', message: { method: 'tools/call', params: { name: 'message', arguments: args, _meta: { 'claudecode/toolUseId': `toolu_${n}` } }, jsonrpc: '2.0', id: n } } } as ControlRequestFrame);
    await flush();
    return ((sent.find((s) => s.requestId === request_id)?.response as { mcp_response: { result: unknown } }).mcp_response.result);
  };
  return { call };
}

describe('the message tool (P4-R7)', () => {
  it('answers an accepted call `sent`, plain text and no error, whatever Markdown the message holds', async () => {
    const { call } = harness();
    expect(await call({ text: 'Stage 2 is done. Calls **0412**, 0977 and 1203 need a person to label them.' })).toEqual({ content: [{ type: 'text', text: 'sent' }] });
    expect(await call({ text: '```\n<message>quoted</message>\n```' })).toEqual({ content: [{ type: 'text', text: 'sent' }] });
  });

  it('sends a subagent’s message too: its row draws in the subagent’s transcript, as its spans do', async () => {
    expect(await harness(true).call({ text: 'From a subagent.' })).toEqual({ content: [{ type: 'text', text: 'sent' }] });
  });

  it('refuses a call with no message: missing, empty or blank text, a text that is no string, or another field', async () => {
    const { call } = harness();
    for (const args of [{}, { text: '' }, { text: '  \n\t' }, { text: 42 }, { text: 'hi', title: 'extra' }, null]) {
      const result = (await call(args)) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.content[0]!.text.startsWith('message: invalid arguments: '), JSON.stringify(args)).toBe(true);
    }
  });

  it('is served last on the maws server, listed with its `_meta` as MAWS lists it', () => {
    const served = mawsTools({ bridge: {} as never, capture: {} as never, asks: {} as never, askCancelled: () => {} });
    const message = served.at(-1)!;
    expect(message.name).toBe('message');
    expect({ name: message.name, title: message.title, description: message.description, inputSchema: message.inputSchema, annotations: message.annotations, _meta: message._meta }).toEqual(mawsToolList().at(-1));
    expect(message._meta).toEqual({ 'anthropic/alwaysLoad': true });
  });
});

// R3: a mounted transcript site crosses X2 and reaches the same attached desktop client as R2.
import { describe, expect, it } from 'vitest';
import { validateCommandInput } from '@shared/ipc/validate';
import type { TranscriptProps, TranscriptSite } from '@shared/engine/surface-rows';
import { registerEngineIpc } from './ipc';
import { handshakeResponder, INIT_RESPONSE, scriptedSession } from './conformance/session-harness';

const call = { tool_use_id: 'tool-1', tool: 'Read', input: { file_path: '/a' }, isRunning: false, isErrored: false, isInterrupted: false, output: { content: 'read' } };
const cases: { [C in TranscriptSite]: { instanceId: string; props: TranscriptProps[C] } } = {
  UserMessage: { instanceId: 'user-message', props: { text: 'Hi', origin: { kind: 'sdk' }, isExpanded: true } },
  AssistantMessage: { instanceId: 'assistant-message', props: { text: 'Hello', isFirstOfReply: true } },
  ToolUse: { instanceId: 'tool-1', props: call },
  ToolResult: { instanceId: 'tool-1', props: { tool_use_id: 'tool-1', tool: 'Read', output: { content: 'read' }, isErrored: false } },
  ToolGroup: { instanceId: 'group:tool-1', props: { calls: [call], isActive: false, isExpanded: false } },
  CommandOutput: { instanceId: 'command-message', props: { command: 'cost', args: '', text: 'No cost', isErrored: false } },
  AskUserQuestion: { instanceId: 'question-tool', props: { tool: 'AskUserQuestion', questions: [{ question: 'Which?', header: 'Choice', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] } },
};

describe('transcript sites reach the attached engine surface', () => {
  it.each(Object.keys(cases) as TranscriptSite[])('accepts and forwards %s with its row identity and props intact', async (component) => {
    const { instanceId, props } = cases[component];
    const input = { appSessionId: 'app-s', component, instanceId, props };
    const accepted = validateCommandInput('session.ui.render', input);
    expect(accepted).toEqual({ ok: true, value: input });
    if (!accepted.ok) throw new Error('transcript site was rejected');
    const answer = { tree: { type: 'engine', ref: 0 }, props, rewritten: false, hooked: true };
    const { session, transport } = scriptedSession({ responder: handshakeResponder({
      initialize: () => ({ response: { ...INIT_RESPONSE, capabilities: ['ui_surface_v1'] } }),
      ui_attach: () => ({ response: { surfaces: ['desktop'] } }),
      ui_panes: () => ({ response: { panes: [] } }),
      ui_render: () => ({ response: answer }),
    }) });
    await session.start();
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerEngineIpc((name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>), () => {}, {
      userData: '/tmp/maws-r3-unused', replayEnabled: false,
      table: { get: () => session, list: () => [session], onBudget: () => {}, onDropped: () => {} } as never,
    });
    expect(await handlers.get('session.ui.render')!(accepted.value)).toEqual(answer);
    expect(transport.requestsOf('ui_render')[0]!.request).toEqual({
      subtype: 'ui_render', surface: 'desktop', client_id: 'maws-main', component, instance_id: instanceId, props,
    });
    transport.exit(0);
  });

  it('continues refusing sites MAWS does not draw', () => {
    expect(validateCommandInput('session.ui.render', { appSessionId: 'app-s', component: 'Thinking', instanceId: 'thinking', props: {} }).ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { framesOf, loadJournal, type FixturePass } from '../../../test/support/fixtures';
import {
  CanUseToolRequestSchema,
  CanUseToolResponseSchema,
  ControlErrorResponseSchema,
  ElicitationRequestSchema,
  ElicitationResponseSchema,
  HookCallbackRequestSchema,
  InitializeResponseSchema,
  InterruptResponseSchema,
  RewindConversationResponseSchema,
  SetPermissionModeResponseSchema,
} from './control';
import { parseStdoutFrame, type ControlRequestFrame, type ControlResponseFrame } from './frames';

type Row = { seq: number; frame: unknown };
const asRequest = (row: Row) => parseStdoutFrame(row.frame) as ControlRequestFrame;
const asResponse = (row: Row) => parseStdoutFrame(row.frame) as ControlResponseFrame;

function controlPairs(pass: FixturePass, name: string, subtype: string) {
  const rows = loadJournal(pass, name);
  const requests = framesOf(rows, 'out').filter((r) => {
    const f = r.frame as { type?: string; request?: { subtype?: string } };
    return f.type === 'control_request' && f.request?.subtype === subtype;
  });
  return requests.map((req) => {
    const requestId = (req.frame as { request_id: string }).request_id;
    const response = framesOf(rows, 'in').find((r) => {
      const f = r.frame as { type?: string; response?: { request_id?: string } };
      return f.type === 'control_response' && f.response?.request_id === requestId;
    });
    if (!response) throw new Error(`${pass}/${name}: no response to ${subtype} ${requestId}`);
    return { request: req, response: asResponse(response) };
  });
}

function inboundRequest(pass: FixturePass, name: string, seq: number) {
  const row = framesOf(loadJournal(pass, name), 'in').find((r) => r.seq === seq);
  if (!row) throw new Error(`${pass}/${name} has no in frame at seq ${seq}`);
  return asRequest(row);
}

describe('control payloads parse from the fixtures', () => {
  it('question-roundtrip: AskUserQuestion travels on the permission channel and its answers come back in updatedInput', () => {
    const rows = loadJournal('pass1', 'question-roundtrip');
    const reqRow = framesOf(rows, 'in').find((r) => (r.frame as { type: string }).type === 'control_request');
    const request = asRequest(reqRow!);
    const canUse = CanUseToolRequestSchema.parse(request.request);
    expect(canUse.tool_name).toBe('AskUserQuestion');
    expect(canUse.requires_user_interaction).toBe(true);
    expect(canUse).toEqual(request.request);
    const respRow = framesOf(rows, 'out').find((r) => {
      const f = r.frame as { type: string; response?: { request_id: string } };
      return f.type === 'control_response' && f.response?.request_id === request.request_id;
    });
    const response = CanUseToolResponseSchema.parse((respRow!.frame as ControlResponseFrame).response.response);
    expect(response.behavior).toBe('allow');
    if (response.behavior !== 'allow') throw new Error('unreachable');
    expect((response.updatedInput as { answers: Record<string, string> }).answers).toEqual({
      'Which color do you prefer?': 'Red',
      'Which fruits do you like?': 'Apple, Pear',
    });
  });

  it('queue-and-interrupt: the interrupt response names one cancelled uuid', () => {
    const [pair] = controlPairs('pass1', 'queue-and-interrupt', 'interrupt');
    expect(pair.response.response.subtype).toBe('success');
    const interrupt = InterruptResponseSchema.parse((pair.response.response as { response: unknown }).response);
    expect(interrupt.still_queued).toEqual([]);
    expect(interrupt.cancelled).toHaveLength(1);
  });

  it('auto-haiku seq 7: the refused permission mode is a control error carrying the refusal code', () => {
    const row = framesOf(loadJournal('pass2', 'auto-haiku'), 'in').find((r) => r.seq === 7)!;
    const frame = asResponse(row);
    const error = ControlErrorResponseSchema.parse(frame.response);
    expect(error.subtype).toBe('error');
    expect(error.error_code).toBe('auto_mode_model');
    expect(error).toEqual(frame.response);
  });

  it('hooks seq 26 parses as HookCallbackRequest', () => {
    const request = inboundRequest('pass2', 'hooks', 26);
    const hook = HookCallbackRequestSchema.parse(request.request);
    expect(hook.callback_id).toBe('maws_pre_bash');
    expect(hook.input.hook_event_name).toBe('PreToolUse');
    expect(hook.input.tool_use_id).toBe(hook.tool_use_id);
    expect(hook).toEqual(request.request);
  });

  it('dialogs seq 41 parses as ElicitationRequest in form mode', () => {
    const request = inboundRequest('pass2', 'dialogs', 41);
    const elicitation = ElicitationRequestSchema.parse(request.request);
    expect(elicitation.mode).toBe('form');
    expect(elicitation.mcp_server_name).toBe('maws-elicit');
    expect(elicitation).toEqual(request.request);
  });

  it('rewind: the stale target is refused, the second rewind succeeds with a prefill', () => {
    const pairs = controlPairs('pass2', 'rewind', 'rewind_conversation');
    expect(pairs).toHaveLength(2);
    const responses = pairs.map((p) => RewindConversationResponseSchema.parse((p.response.response as { response: unknown }).response));
    expect(responses[0].rewound).toBe(false);
    expect(responses[0].reason).toBe('stale_target');
    expect(responses[1].rewound).toBe(true);
    expect(responses[1].prefillText).toBe('Also remember the word BANANA. Reply OK.');
    expect(responses[1].precedingAssistantUuid).toBe('edf0f954-1b18-4bca-a53f-d3212ef6dbaa');
  });

  it('initialize and set_permission_mode responses parse across both passes', () => {
    for (const [pass, name] of [['pass1', 'init'], ['pass2', 'auto-routed'], ['pass2', 'trust-attested']] as const) {
      for (const pair of controlPairs(pass, name, 'initialize')) {
        const init = InitializeResponseSchema.parse((pair.response.response as { response: unknown }).response);
        expect(Array.isArray(init.commands)).toBe(true);
        expect(typeof init.current_permission_mode).toBe('string');
      }
    }
    // auto-routed asks for auto twice: the engine grants one and refuses one with a control error.
    const outcomes = controlPairs('pass2', 'auto-routed', 'set_permission_mode').map((pair) => {
      const response = pair.response.response;
      if (response.subtype === 'error') return ControlErrorResponseSchema.parse(response).error_code;
      return SetPermissionModeResponseSchema.parse(response.response).mode;
    });
    expect(outcomes.length).toBeGreaterThan(0);
    for (const outcome of outcomes) expect(typeof outcome).toBe('string');
  });

  it('rejects malformed control payloads', () => {
    expect(CanUseToolRequestSchema.safeParse({ subtype: 'can_use_tool', tool_name: 'Bash', input: {} }).success).toBe(false); // tool_use_id
    expect(CanUseToolResponseSchema.safeParse({ behavior: 'deny' }).success).toBe(false); // message
    expect(CanUseToolResponseSchema.safeParse({ behavior: 'maybe' }).success).toBe(false);
    expect(CanUseToolResponseSchema.safeParse({ behavior: 'allow' }).success).toBe(true);
    expect(ElicitationResponseSchema.safeParse({ action: 'accept', content: { color: 'red' } }).success).toBe(true);
    expect(ElicitationResponseSchema.safeParse({ action: 'decline' }).success).toBe(true);
    expect(ElicitationResponseSchema.safeParse({ action: 'ignore' }).success).toBe(false);
    expect(ControlErrorResponseSchema.safeParse({ subtype: 'success', request_id: 'r' }).success).toBe(false);
    expect(InterruptResponseSchema.safeParse({ cancelled: [] }).success).toBe(false); // still_queued
    expect(RewindConversationResponseSchema.safeParse({ rewound: true }).success).toBe(false); // prefillText, precedingAssistantUuid
  });
});

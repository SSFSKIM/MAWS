import { describe, expect, it } from 'vitest';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { ControlRequestFrame } from '@shared/wire/frames';
import { loadJournal } from '../../test/support/fixtures';
import { PermissionBroker, type BrokerDeps } from './broker';

const APP = 'app-b' as AppSessionId;
const rid = (s: string) => s as RequestId;

function canUseTool(id: string, extra: Record<string, unknown> = {}): ControlRequestFrame {
  return {
    type: 'control_request', request_id: id,
    request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'touch granted.txt', description: 'Create granted.txt file' }, description: 'Create granted.txt file', tool_use_id: `toolu_${id}`, ...extra },
  };
}
const elicitation = (id: string, extra: Record<string, unknown> = {}): ControlRequestFrame => ({ type: 'control_request', request_id: id, request: { subtype: 'elicitation', mcp_server_name: 'maws-elicit', message: 'pick', mode: 'form', ...extra } });
const dialog = (id: string, kind: string): ControlRequestFrame => ({ type: 'control_request', request_id: id, request: { subtype: 'request_user_dialog', dialog_kind: kind, payload: { a: 1 } } });
const toolResult = (toolUseId: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] }, parent_tool_use_id: null, session_id: 's' });
const result = (extra: Record<string, unknown> = {}) => ({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', ...extra });

function setup(opts: { failWrites?: boolean; exiting?: boolean } = {}) {
  const responses: { requestId: string; response: unknown; preface?: Record<string, unknown>[] }[] = [];
  const meta: Record<string, unknown>[] = [];
  const lists: AttentionItem[][] = [];
  const grants: unknown[][] = [];
  let exiting = opts.exiting ?? false;
  const deps: BrokerDeps = {
    appSessionId: APP,
    sessionId: () => null,
    client: {
      respond: async (requestId, response, respondOpts) => {
        if (opts.failWrites) throw new Error('EPIPE');
        responses.push({ requestId, response, ...(respondOpts?.preface ? { preface: respondOpts.preface } : {}) });
      },
    },
    meta: (frame) => meta.push(frame),
    onAttention: (items) => {
      for (const item of items) AttentionItemSchema.parse(item);
      lists.push(items);
    },
    onGrant: (updates) => grants.push(updates),
    isExiting: () => exiting,
    now: () => '2026-09-28T12:00:00.000Z',
  };
  const broker = new PermissionBroker(deps);
  return { broker, responses, meta, lists, grants, setExiting: (v: boolean) => (exiting = v), last: () => lists.at(-1) ?? [] };
}

describe('permission broker states and the approvals-lost rule', () => {
  it('pending at accept, delivered when the write resolves, confirmed at the tool_result, retired at the turn result', async () => {
    const { broker, last } = setup();
    broker.accept(canUseTool('r1'));
    expect(broker.item(rid('r1'))?.attention.state).toBe('pending');
    expect(last()).toMatchObject([{ id: 'app-b:r1', kind: 'permission', state: 'pending', summary: 'Bash: touch granted.txt', request: { requestId: 'r1', toolUseId: 'toolu_r1', taskId: null, agentId: null } }]);
    expect(await broker.answer(rid('r1'), { kind: 'permission', decision: 'allow', scope: 'once' })).toBe('delivered');
    expect(broker.item(rid('r1'))).toMatchObject({ attention: { state: 'delivered' }, deliveredAt: '2026-09-28T12:00:00.000Z', confirmedAt: null, retiredReason: null });
    broker.observe({ type: 'stream_event', event: { type: 'message_stop' }, session_id: 's' });
    expect(broker.item(rid('r1'))?.attention.state).toBe('delivered');
    broker.observe(toolResult('toolu_r1'));
    expect(broker.item(rid('r1'))).toMatchObject({ attention: { state: 'confirmed' }, confirmedAt: '2026-09-28T12:00:00.000Z' });
    broker.observe(result());
    expect(broker.item(rid('r1'))).toBeUndefined(); // retired: only a tombstone (request id and reason) remains
    expect(broker.retiredReason(rid('r1'))).toBe('answered');
    expect(last()).toEqual([]);
    expect(broker.processExited()).toEqual({ lost: 0 });
  });

  it('confirms by tool_progress, a hook_callback, system/permission_denied or result.permission_denials', async () => {
    const frames: Record<string, unknown> = {
      a: { type: 'tool_progress', tool_use_id: 'toolu_a', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 1, session_id: 's' },
      b: { type: 'control_request', request_id: 'h1', request: { subtype: 'hook_callback', callback_id: 'x', input: { hook_event_name: 'PostToolUse', tool_use_id: 'toolu_b' } } },
      c: { type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'toolu_c', session_id: 's' },
      d: result({ num_turns: 0, terminal_reason: undefined, permission_denials: [{ tool_name: 'Bash', tool_use_id: 'toolu_d', tool_input: {} }] }),
    };
    for (const [id, frame] of Object.entries(frames)) {
      const { broker } = setup();
      broker.accept(canUseTool(id));
      await broker.answer(rid(id), { kind: 'permission', decision: 'deny' });
      broker.observe(frame);
      expect(broker.item(rid(id))?.attention.state).toBe('confirmed');
    }
  });

  it('a confirming frame is ignored while the answer has not flushed: only a delivered item confirms (the session orders frames after the flush)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const lists: AttentionItem[][] = [];
    const broker = new PermissionBroker({ appSessionId: APP, client: { respond: () => gate }, meta: () => {}, onAttention: (items) => lists.push(items), now: () => 'T' });
    broker.accept(canUseTool('r1'));
    broker.accept(elicitation('e1'));
    const answering = broker.answer(rid('r1'), { kind: 'permission', decision: 'allow', scope: 'once' });
    const answeringE = broker.answer(rid('e1'), { kind: 'elicitation', action: 'decline' });
    broker.observe(toolResult('toolu_r1'));
    broker.observe(result());
    expect(broker.item(rid('r1'))?.attention.state).toBe('pending');
    expect(broker.item(rid('e1'))?.attention.state).toBe('pending'); // an unflushed id-less answer does not retire at a result
    release();
    expect(await answering).toBe('delivered');
    expect(await answeringE).toBe('delivered');
    expect(lists.at(-1)!.map((i) => i.state)).toEqual(['delivered', 'delivered']);
  });

  it('retired tombstones are bounded to the last 1,000 per process', () => {
    const { broker } = setup();
    for (let i = 0; i < 1_001; i += 1) {
      broker.accept(canUseTool(`t${i}`));
      broker.observe({ type: 'control_cancel_request', request_id: `t${i}` });
    }
    expect(broker.retiredReason(rid('t0'))).toBeNull();
    expect(broker.retiredReason(rid('t1'))).toBe('abort');
    expect(broker.retiredReason(rid('t1000'))).toBe('abort');
  });

  it('a control_cancel_request for a pending id retires it with abort; answering it afterwards is not_pending', async () => {
    const { broker, last, responses } = setup();
    broker.accept(canUseTool('r1'));
    broker.observe({ type: 'control_cancel_request', request_id: 'r1' });
    expect(broker.item(rid('r1'))).toBeUndefined();
    expect(broker.retiredReason(rid('r1'))).toBe('abort');
    expect(last()).toEqual([]);
    expect(await broker.answer(rid('r1'), { kind: 'permission', decision: 'deny' })).toBe('not_pending');
    expect(responses).toEqual([]);
  });

  it('processExited with two pending and one delivered item returns lost 3 and retires them; with none, lost 0', async () => {
    const { broker, last } = setup();
    broker.accept(canUseTool('r1'));
    broker.accept(canUseTool('r2'));
    broker.accept(elicitation('r3'));
    await broker.answer(rid('r3'), { kind: 'elicitation', action: 'accept', content: { color: 'teal' } });
    expect(broker.live).toBe(3);
    expect(broker.processExited()).toEqual({ lost: 3 });
    expect(['r1', 'r2', 'r3'].map((id) => broker.retiredReason(rid(id)))).toEqual(['exit', 'exit', 'exit']);
    expect(last()).toEqual([]);
    expect(setup().broker.processExited()).toEqual({ lost: 0 });
  });

  it('a request that arrives while the process is exiting is retired at once, unanswered, and counts as lost', () => {
    const { broker, responses, last } = setup({ exiting: true });
    broker.accept(canUseTool('r1'));
    expect(broker.retiredReason(rid('r1'))).toBe('exit');
    expect(last()).toEqual([]);
    expect(responses).toEqual([]);
    expect(broker.processExited()).toEqual({ lost: 1 });
  });

  it('answers not_pending for an unknown or already delivered id, write_failed when the write rejects (the item stays pending)', async () => {
    const { broker } = setup();
    expect(await broker.answer(rid('nope'), { kind: 'permission', decision: 'deny' })).toBe('not_pending');
    broker.accept(canUseTool('r1'));
    expect(await broker.answer(rid('r1'), { kind: 'permission', decision: 'deny' })).toBe('delivered');
    expect(await broker.answer(rid('r1'), { kind: 'permission', decision: 'deny' })).toBe('not_pending');
    const failing = setup({ failWrites: true });
    failing.broker.accept(canUseTool('r2'));
    expect(await failing.broker.answer(rid('r2'), { kind: 'permission', decision: 'deny' })).toBe('write_failed');
    expect(failing.broker.item(rid('r2'))?.attention.state).toBe('pending');
  });

  it('refuses an answer of the wrong kind', async () => {
    const { broker } = setup();
    broker.accept(canUseTool('r1'));
    await expect(broker.answer(rid('r1'), { kind: 'question', answers: {} })).rejects.toThrow(/permission/);
  });

  it('re-accepts the requests an initialize response carries in pending_permission_requests, once', () => {
    const { broker, last } = setup();
    const envelope = { type: 'control_response', response: { subtype: 'success', request_id: 'init-1', response: {}, pending_permission_requests: [canUseTool('r9')], pending_user_dialog_requests: [] } };
    broker.observe(envelope);
    broker.observe(envelope);
    expect(last()).toMatchObject([{ id: 'app-b:r9', kind: 'permission', state: 'pending' }]);
  });

  it('an undeclared request_user_dialog kind stays pending with a warning notice journaled as a meta row', () => {
    const { broker, meta, last, responses } = setup();
    broker.accept(dialog('d1', 'auto_mode_server_fallback'));
    broker.accept(dialog('d2', 'something_new'));
    expect(meta).toEqual([{ event: 'notice', level: 'warning', key: 'dialog:undeclared:d2', text: expect.stringContaining('something_new') }]);
    expect(last().map((i) => [i.id, i.state, i.summary])).toEqual([['app-b:d1', 'pending', 'auto_mode_server_fallback'], ['app-b:d2', 'pending', 'something_new']]);
    expect(responses).toEqual([]);
  });

  it('an answer for an undeclared dialog kind is refused like a wrong-kind answer; the item stays pending and nothing is written', async () => {
    const { broker, responses } = setup();
    broker.accept(dialog('d2', 'something_new'));
    for (const behavior of ['completed', 'cancelled'] as const) {
      await expect(broker.answer(rid('d2'), { kind: 'dialog', behavior })).rejects.toThrow(/something_new/);
    }
    expect(broker.item(rid('d2'))?.attention.state).toBe('pending');
    expect(responses).toEqual([]);
    expect(await broker.answer(rid('d2'), { kind: 'elicitation', action: 'cancel' }).catch((e: unknown) => (e as Error).name)).toBe('BrokerAnswerMismatch');
  });

  it('a retired item keeps only a tombstone, and a re-delivery of its request id is not re-accepted', () => {
    const { broker, last } = setup();
    broker.accept(canUseTool('r1'));
    broker.observe({ type: 'control_cancel_request', request_id: 'r1' });
    broker.accept(canUseTool('r1'));
    expect(broker.item(rid('r1'))).toBeUndefined();
    expect(last()).toEqual([]);
  });

  it('summaries: the first question, the plan, the MCP server name', () => {
    const { broker, last } = setup();
    const question = loadJournal('pass1', 'question-roundtrip').find((r) => r.seq === 137)!.frame as ControlRequestFrame;
    broker.accept(question);
    broker.accept({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', input: { plan: '# Plan' }, tool_use_id: 'toolu_p' } });
    broker.accept(elicitation('e1'));
    expect(last().map((i) => [i.kind, i.summary])).toEqual([['question', 'Which color do you prefer?'], ['plan', 'Plan ready for review'], ['elicitation', 'maws-elicit']]);
  });
});

describe('id-less requests retire at the turn\'s end', () => {
  it('a delivered elicitation is never confirmed and retires turn_ended at the next main-lane result; echo receipts and child results do not count', async () => {
    const { broker } = setup();
    broker.accept(elicitation('e1'));
    await broker.answer(rid('e1'), { kind: 'elicitation', action: 'decline' });
    broker.observe(toolResult('toolu_other'));
    broker.observe(result({ num_turns: 0, terminal_reason: undefined })); // an echo receipt
    broker.observe(result({ parent_tool_use_id: 'toolu_parent' }));
    expect(broker.item(rid('e1'))?.attention.state).toBe('delivered');
    broker.observe(result());
    expect(broker.item(rid('e1'))).toBeUndefined();
    expect(broker.retiredReason(rid('e1'))).toBe('turn_ended');
  });

  it('a pending id-less item survives the result (only delivery starts the clock) and an elicitation_complete retires it', () => {
    const { broker } = setup();
    broker.accept(elicitation('e1', { elicitation_id: 'el-1' }));
    broker.observe(result());
    expect(broker.item(rid('e1'))?.attention.state).toBe('pending');
    broker.observe({ type: 'system', subtype: 'elicitation_complete', mcp_server_name: 'maws-elicit', elicitation_id: 'el-1', session_id: 's' });
    expect(broker.retiredReason(rid('e1'))).toBe('answered');
  });
});

describe('plan outcomes map to the wire', () => {
  const plan = (id: string): ControlRequestFrame => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', input: { plan: '# Plan\n1. do it', planFilePath: '/p.md' }, tool_use_id: `toolu_${id}` } });

  it('implement is a bare allow with the request input; keep_planning denies with the feedback; clear_and_implement denies with the contract message and interrupts the turn', async () => {
    const { broker, responses } = setup();
    for (const id of ['p1', 'p2', 'p3', 'p4']) broker.accept(plan(id));
    await broker.answer(rid('p1'), { kind: 'plan', outcome: 'implement', feedback: null });
    await broker.answer(rid('p2'), { kind: 'plan', outcome: 'keep_planning', feedback: 'Add tests first.' });
    await broker.answer(rid('p3'), { kind: 'plan', outcome: 'keep_planning', feedback: null });
    await broker.answer(rid('p4'), { kind: 'plan', outcome: 'clear_and_implement', feedback: null });
    expect(responses.map((r) => r.response)).toEqual([
      { behavior: 'allow', updatedInput: { plan: '# Plan\n1. do it', planFilePath: '/p.md' } },
      { behavior: 'deny', message: 'Add tests first.' },
      { behavior: 'deny', message: 'Keep planning.' },
      // interrupt: a live run (M6) showed the model reading the bare deny as approval and implementing in plan mode
      { behavior: 'deny', message: 'Plan approved; MAWS is clearing context and will restart with the plan.', interrupt: true },
    ]);
  });
});

describe('permission answers on the wire', () => {
  it('allow once, session (suggestion rewritten to session, else built from the request), local_settings, deny and deny_and_stop', async () => {
    const { broker, responses, grants } = setup();
    const withSuggestions = loadJournal('pass2', 'grant-reapply-start').find((r) => r.seq === 30)!.frame as ControlRequestFrame;
    const recorded = loadJournal('pass2', 'grant-reapply-start').find((r) => r.seq === 32)!.frame as { response: { response: unknown } };
    broker.accept(withSuggestions);
    await broker.answer(rid(withSuggestions.request_id), { kind: 'permission', decision: 'allow', scope: 'session' });
    const [first] = responses;
    expect(first!.response).toEqual({ ...(recorded.response.response as object), decisionClassification: 'user_permanent' });
    expect(grants).toEqual([[{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'session' }]]);

    broker.accept(canUseTool('s2', { tool_name: 'Read', input: { file_path: '/x' } }));
    await broker.answer(rid('s2'), { kind: 'permission', decision: 'allow', scope: 'session' });
    expect(responses[1]!.response).toEqual({ behavior: 'allow', updatedInput: { file_path: '/x' }, decisionClassification: 'user_permanent', updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'session' }] });

    broker.accept(canUseTool('s3'));
    await broker.answer(rid('s3'), { kind: 'permission', decision: 'allow', scope: 'session' });
    expect((responses[2]!.response as { updatedPermissions: unknown }).updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'session' }]);

    broker.accept(withSuggestions.request_id === 'l1' ? withSuggestions : { ...withSuggestions, request_id: 'l1' });
    await broker.answer(rid('l1'), { kind: 'permission', decision: 'allow', scope: 'local_settings', updatedInput: { command: 'touch granted.txt' } });
    expect(responses[3]!.response).toEqual({ behavior: 'allow', updatedInput: { command: 'touch granted.txt' }, decisionClassification: 'user_permanent', updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'localSettings' }] });

    broker.accept(canUseTool('o1'));
    await broker.answer(rid('o1'), { kind: 'permission', decision: 'allow', scope: 'once' });
    expect(responses[4]!.response).toEqual({ behavior: 'allow', updatedInput: { command: 'touch granted.txt', description: 'Create granted.txt file' }, decisionClassification: 'user_temporary' });

    broker.accept(canUseTool('d1'));
    broker.accept(canUseTool('d2'));
    await broker.answer(rid('d1'), { kind: 'permission', decision: 'deny' });
    await broker.answer(rid('d2'), { kind: 'permission', decision: 'deny_and_stop', message: 'Stop here.' });
    expect(responses.slice(5).map((r) => r.response)).toEqual([
      { behavior: 'deny', message: 'Denied by the user in MAWS.', decisionClassification: 'user_reject' },
      { behavior: 'deny', message: 'Stop here.', decisionClassification: 'user_reject', interrupt: true },
    ]);
    expect(grants).toHaveLength(4); // every updatedPermissions sent (three session, one localSettings); nothing for once or deny
  });

  it('an ask-rule prompt never gets an always-allow scope: downgraded to once, the note journaled before the answer', async () => {
    for (const [extra, note] of [
      [{ decision_reason_type: 'rule' }, 'scope downgraded: ask rule'],
      [{ matched_ask_rule: { source: 'userSettings', toolName: 'Bash', ruleContent: 'git log:*' } }, 'scope downgraded: ask rule'],
      [{ suppress_always_allow_rule: true }, 'scope downgraded: always-allow suppressed'],
    ] as const) {
      const { broker, responses, meta, grants } = setup();
      broker.accept(canUseTool('r1', extra));
      expect(await broker.answer(rid('r1'), { kind: 'permission', decision: 'allow', scope: 'session' })).toBe('delivered');
      expect(responses[0]!.response).toEqual({ behavior: 'allow', updatedInput: { command: 'touch granted.txt', description: 'Create granted.txt file' }, decisionClassification: 'user_temporary' });
      expect(responses[0]!.preface).toEqual([{ event: 'answer_note', requestId: 'r1', note }]); // journaled with the flushed answer only
      expect(meta).toEqual([]);
      expect(grants).toEqual([]);
    }
  });

  it('question answers ride updatedInput keyed by the exact question strings of pass1/question-roundtrip', async () => {
    const { broker, responses } = setup();
    const journal = loadJournal('pass1', 'question-roundtrip');
    const request = journal.find((r) => r.seq === 137)!.frame as ControlRequestFrame;
    const recorded = journal.find((r) => r.seq === 138)!.frame as { response: { response: unknown } };
    broker.accept(request);
    await broker.answer(rid(request.request_id), { kind: 'question', answers: { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' } });
    expect(responses[0]!.response).toEqual(recorded.response.response);
  });

  it('dialogs and elicitations answer verbatim (pass2/dialogs seq 43)', async () => {
    const { broker, responses } = setup();
    const journal = loadJournal('pass2', 'dialogs');
    const request = journal.find((r) => r.seq === 41)!.frame as ControlRequestFrame;
    const recorded = journal.find((r) => r.seq === 43)!.frame as { response: { response: unknown } };
    broker.accept(request);
    broker.accept(dialog('d1', 'refusal_fallback_prompt'));
    await broker.answer(rid(request.request_id), { kind: 'elicitation', action: 'accept', content: { color: 'teal' } });
    await broker.answer(rid('d1'), { kind: 'dialog', behavior: 'cancelled' });
    expect(responses.map((r) => r.response)).toEqual([recorded.response.response, { behavior: 'cancelled' }]);
  });
});

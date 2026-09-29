import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { FIXTURE_DIR, framesOf, listJournals, loadJournal, type FixturePass } from '../../../test/support/fixtures';
import { parseJournalRow } from './journal';
import {
  parseStdinFrame,
  parseStdoutFrame,
  SafeguardResultSchema,
  STDOUT_FRAME_SCHEMAS,
  SYSTEM_SUBTYPE_SCHEMAS,
  UnknownFrameSchema,
  UnknownSystemFrameSchema,
  type ResultFrame,
  type StreamEventFrame,
} from './frames';

const PASS_DIRS: Record<FixturePass, string> = { pass1: FIXTURE_DIR, pass2: join(FIXTURE_DIR, 'pass2'), pass3: join(FIXTURE_DIR, 'pass3') }; // C3: pass3 added with FixturePass

function describeFailure(label: string, seq: number, error: unknown): string {
  const issues = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`) : [String(error)];
  return `${label} seq ${seq}: ${issues.join('; ')}`;
}

describe('wire frames round-trip every probe fixture', () => {
  it('finds both passes', () => {
    expect(listJournals('pass1')).toEqual([
      'init', 'permission-roundtrip', 'question-roundtrip', 'queue-and-interrupt', 'reads',
      'resume-fork-cli', 'resume-fork-no-replay', 'resume-fork-replay', 'resume-fork-start', 'subagent',
    ]);
    expect(listJournals('pass2')).toHaveLength(30);
    expect(listJournals('pass2')).toContain('rewind');
  });

  for (const pass of ['pass1', 'pass2'] as const) {
    for (const name of listJournals(pass)) {
      it(`${pass}/${name}`, () => {
        const label = `${pass}/${name}`;
        const rawRows = readFileSync(join(PASS_DIRS[pass], `${name}.jsonl`), 'utf8')
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as { seq: number });
        const failures: string[] = [];
        const check = (seq: number, parse: () => unknown, input: unknown) => {
          try {
            expect(parse()).toEqual(input);
          } catch (error) {
            failures.push(describeFailure(label, seq, error));
          }
        };
        for (const raw of rawRows) check(raw.seq, () => parseJournalRow(raw), raw);
        const rows = loadJournal(pass, name);
        for (const { seq, frame } of framesOf(rows, 'in')) check(seq, () => parseStdoutFrame(frame), frame);
        for (const { seq, frame } of framesOf(rows, 'out')) check(seq, () => parseStdinFrame(frame), frame);
        expect(rows.length).toBeGreaterThan(0);
        expect(failures).toEqual([]);
      });
    }
  }
});

// Value pins on the parsed frames: the pass-2 facts the events derive from (M2 "Proves"), asserted through the typed schemas.
describe('wire frames carry the pass-2 facts the events derive from', () => {
  const inFrame = (pass: FixturePass, name: string, seq: number) => {
    const row = framesOf(loadJournal(pass, name), 'in').find((r) => r.seq === seq);
    if (!row) throw new Error(`${pass}/${name} has no in frame at seq ${seq}`);
    return parseStdoutFrame(row.frame);
  };

  it('auto-classifier seq 34: the message_delta names exactly one tool use, evaluated not_flagged', () => {
    const frame = inFrame('pass2', 'auto-classifier', 34) as StreamEventFrame;
    expect(frame.type).toBe('stream_event');
    expect(frame.event.type).toBe('message_delta');
    const delta = frame.event.delta as { safeguard_results: unknown[] };
    const results = delta.safeguard_results.map((r) => SafeguardResultSchema.parse(r));
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('dangerous_tool_use');
    const toolUses = results[0].status.tool_uses ?? {};
    expect(Object.keys(toolUses)).toHaveLength(1);
    const [toolUseId] = Object.keys(toolUses);
    expect(toolUseId).toMatch(/^toolu_/);
    expect(toolUses[toolUseId]).toEqual({ type: 'evaluated', outcome: 'not_flagged' });
  });

  it('workflow seq 108: the result is an engine-initiated turn', () => {
    const frame = inFrame('pass2', 'workflow', 108) as ResultFrame;
    expect(frame.type).toBe('result');
    expect((frame.origin as { kind: string }).kind).toBe('task-notification');
    expect(frame.result_index).toBe(1);
  });

  it('bash-context-echoed: the first result is the echo receipt of a shouldQuery:false frame', () => {
    const rows = loadJournal('pass2', 'bash-context-echoed');
    const echo = framesOf(rows, 'out').find((r) => (r.frame as { shouldQuery?: boolean }).shouldQuery === false);
    expect(echo).toBeDefined();
    const first = framesOf(rows, 'in').find((r) => (r.frame as { type: string }).type === 'result');
    expect(first).toBeDefined();
    expect(first!.seq).toBeGreaterThan(echo!.seq);
    const result = parseStdoutFrame(first!.frame) as ResultFrame;
    expect(result.num_turns).toBe(0);
    expect(result.terminal_reason).toBeUndefined();
    expect(result.total_cost_usd).toBe(0);
    expect((result.origin as { kind: string }).kind).toBe('human');
  });
});

describe('wire frames reject malformed input', () => {
  // Asserts the frame is rejected with a ZodError naming `path` among its issues.
  const rejects = (frame: unknown, path: string) => {
    let error: unknown = null;
    try {
      parseStdoutFrame(frame);
    } catch (thrown) {
      error = thrown;
    }
    expect(error, `${JSON.stringify(frame)} should be rejected`).toBeInstanceOf(z.ZodError);
    expect((error as z.ZodError).issues.map((i) => i.path.join('.'))).toContain(path);
  };

  it('tolerates an unknown frame type and retains it whole', () => {
    const frame = { type: 'wibble', x: 1 };
    expect(parseStdoutFrame(frame)).toEqual(frame);
    expect(UnknownFrameSchema.parse(frame)).toEqual(frame);
    expect('wibble' in STDOUT_FRAME_SCHEMAS).toBe(false);
  });

  it('rejects a control_request without request_id even though the loose schema would accept it', () => {
    const malformed = { type: 'control_request', request: { subtype: 'can_use_tool' } };
    expect(UnknownFrameSchema.safeParse(malformed).success).toBe(true);
    rejects(malformed, 'request_id');
    const wellFormed = { ...malformed, request_id: 'r' };
    expect(parseStdoutFrame(wellFormed)).toEqual(wellFormed);
  });

  it('rejects a known system subtype that fails its own schema, and keeps an unknown subtype', () => {
    rejects({ type: 'system', subtype: 'init', session_id: 's' }, 'cwd');
    expect(UnknownSystemFrameSchema.safeParse({ type: 'system', subtype: 'init', session_id: 's' }).success).toBe(true);
    expect('init' in SYSTEM_SUBTYPE_SCHEMAS).toBe(true);
    const unknown = { type: 'system', subtype: 'wibble' };
    expect(parseStdoutFrame(unknown)).toEqual(unknown);
    expect('wibble' in SYSTEM_SUBTYPE_SCHEMAS).toBe(false);
  });

  it('the system entry of the stdout table dispatches on subtype like parseStdoutFrame does', () => {
    const system = STDOUT_FRAME_SCHEMAS.system;
    const malformed = system.safeParse({ type: 'system', subtype: 'init', session_id: 's' });
    expect(malformed.success).toBe(false);
    if (!malformed.success) expect(malformed.error.issues.map((i) => i.path.join('.'))).toContain('cwd');
    const unknown = { type: 'system', subtype: 'wibble', anything: [1] };
    expect(system.parse(unknown)).toEqual(unknown);
    const init = framesOf(loadJournal('pass1', 'init'), 'in').find((r) => (r.frame as { type: string }).type === 'system')!.frame;
    expect(system.parse(init)).toEqual(init);
    expect(SYSTEM_SUBTYPE_SCHEMAS.init.parse(init)).toEqual(init);
  });

  it('rejects a system frame without a subtype', () => {
    rejects({ type: 'system', session_id: 's' }, 'subtype');
  });

  it('rejects a control_response success without request_id', () => {
    rejects({ type: 'control_response', response: { subtype: 'success' } }, 'response.request_id');
  });

  it('rejects a user frame whose message role is not user', () => {
    rejects({ type: 'user', message: { role: 'assistant', content: 'x' } }, 'message.role');
  });

  it('rejects a stream_event with an empty event', () => {
    rejects({ type: 'stream_event', event: {} }, 'event.type');
  });

  it('rejects a command_lifecycle with an unknown state', () => {
    rejects({ type: 'command_lifecycle', command_uuid: 'x', state: 'exploded' }, 'state');
  });

  it('rejects a result without accounting fields and an assistant without a message id', () => {
    rejects({ type: 'result', subtype: 'success', is_error: false }, 'session_id');
    rejects({ type: 'assistant', message: { role: 'assistant', content: [], model: 'm' }, session_id: 's', uuid: 'u', parent_tool_use_id: null }, 'message.id');
  });

  it('rejects a frame that is not an object or has no string type', () => {
    expect(() => parseStdoutFrame(null)).toThrow(z.ZodError);
    expect(() => parseStdoutFrame('user')).toThrow(z.ZodError);
    expect(() => parseStdoutFrame({ type: 7 })).toThrow(z.ZodError);
    expect(() => parseStdoutFrame({})).toThrow(z.ZodError);
  });

  it('rejects stdin frames outside the authored union and malformed authored ones', () => {
    expect(() => parseStdinFrame({ type: 'wibble' })).toThrow(z.ZodError);
    expect(() => parseStdinFrame({ type: 'user', message: { role: 'user', content: 'hi' } })).toThrow(z.ZodError); // parent_tool_use_id missing
    expect(() => parseStdinFrame({ type: 'bash_command' })).toThrow(z.ZodError);
    expect(() => parseStdinFrame({ type: 'user', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null, priority: 'whenever' })).toThrow(z.ZodError);
    const ok = { type: 'user', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null, origin: { kind: 'human' }, shouldQuery: false, extra: true };
    expect(parseStdinFrame(ok)).toEqual(ok);
    expect(parseStdinFrame({ type: 'keep_alive' })).toEqual({ type: 'keep_alive' });
  });

  it('exposes one dispatch entry per known discriminator', () => {
    expect(Object.keys(STDOUT_FRAME_SCHEMAS).sort()).toEqual([
      'assistant', 'auth_status', 'command_lifecycle', 'control_cancel_request', 'control_request', 'control_response',
      'conversation_reset', 'keep_alive', 'prompt_suggestion', 'rate_limit_event', 'result', 'stream_event', 'system',
      'tool_progress', 'tool_use_summary', 'user',
    ]);
    expect(Object.keys(SYSTEM_SUBTYPE_SCHEMAS).sort()).toEqual([
      'api_retry', 'background_tasks_changed', 'commands_changed', 'compact_boundary', 'elicitation_complete',
      'hook_progress', 'hook_response', 'hook_started', 'informational', 'init', 'model_refusal_fallback',
      'model_refusal_no_fallback', 'notification', 'peer_message_hold', 'permission_denied', 'session_state_changed',
      'status', 'task_notification', 'task_progress', 'task_started', 'task_updated', 'thinking_tokens',
    ]);
  });
});

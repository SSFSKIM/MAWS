// P3-H: a connector call's success always carries a result, on the host's operation outcome and on the page's answer
// alike. The engine host and main both refuse a tool answer that is not JSON (undefined included), so a success whose
// `result` is missing never exists; the schema says so, which also keeps `connectors.take` surviving the host's JSON
// wire (a required key typed `unknown` is the kind JSON drops).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { McpCallResponseSchema } from '../../wire/control';
import { validateCommandOutput, validateEventPayload } from '../validate';

const FIXTURE = 'e2e/fixtures/connectors/run-38892612152/names/engine-wire.jsonl';
const VIA = { route: 'engine', sessionId: 'app-1' } as const;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Row { direction: string; frame: { type?: string; request_id?: string; request?: { subtype?: string }; response?: { subtype?: string; request_id?: string; response?: unknown } } }

// The answers the engine gave to `mcp_call` in the recorded run.
function recordedMcpAnswers(): unknown[] {
  const rows = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row);
  const asked = new Set(rows.filter((row) => row.direction === 'out' && row.frame.request?.subtype === 'mcp_call').map((row) => row.frame.request_id));
  return rows.flatMap((row) => (row.direction === 'in' && row.frame.type === 'control_response' && row.frame.response?.subtype === 'success' && asked.has(row.frame.response.request_id) ? [row.frame.response.response] : []));
}

describe('a connector call success carries a result', () => {
  const take = (outcome: unknown) => validateCommandOutput('connectors.take', { outcome });
  const call = (answer: unknown) => validateCommandOutput('connectors.call', answer);
  const update = (answer: unknown) => validateEventPayload('connectors.watchUpdate', { leaseId: '00000000-0000-4000-8000-000000000001', watchId: '00000000-0000-4000-8000-000000000002', update: answer });

  it('refuses an operation success whose result is missing or undefined', () => {
    expect(take({ ok: true }).ok, 'missing').toBe(false);
    expect(take({ ok: true, result: undefined }).ok, 'undefined').toBe(false);
    expect(take({ ok: true, result: () => 1 }).ok, 'a function').toBe(false);
    expect(take({ ok: true, result: { rows: undefined } }).ok, 'a key JSON would drop').toBe(false);
  });

  it('refuses a page answer success whose result is missing or undefined', () => {
    for (const answer of [{ ok: true, fetchedAt: 1, via: VIA }, { ok: true, result: undefined, fetchedAt: 1, via: VIA }]) {
      expect(call(answer).ok).toBe(false);
      expect(update(answer).ok).toBe(false);
    }
  });

  it('keeps every JSON value a tool may answer, null and the falsy ones included', () => {
    for (const result of [null, 0, '', false, [], {}, 'text', 7, [1, { a: null }], { content: 'x', structuredContent: { rows: [[1, 'a']] }, _meta: { n: 1 } }]) {
      expect(take({ ok: true, result }).ok, JSON.stringify(result)).toBe(true);
      expect(call({ ok: true, result, fetchedAt: 1, via: VIA }).ok, JSON.stringify(result)).toBe(true);
      expect(update({ ok: true, result, fetchedAt: 1, via: VIA }).ok, JSON.stringify(result)).toBe(true);
    }
  });

  it('still answers failures and refusals as before', () => {
    expect(take({ ok: false, failure: 'failed', message: 'tool error' }).ok).toBe(true);
    expect(take({ ok: false, failure: 'refused', refusal: 'notGranted', message: 'm' }).ok).toBe(true);
    expect(take(null).ok).toBe(true);
    expect(call({ ok: false, state: 'paused', reason: 'noRoute' }).ok).toBe(true);
  });

  it('every recorded mcp_call answer is a success that survives a JSON round trip', () => {
    const answers = recordedMcpAnswers();
    expect(answers.length).toBeGreaterThanOrEqual(5);
    for (const answer of answers) {
      const result = McpCallResponseSchema.parse(answer);
      const outcome = { ok: true, result };
      const copy = take(json(outcome));
      expect(copy.ok).toBe(true);
      expect(copy.ok && copy.value.outcome).toEqual(outcome);
      expect(call(json({ ...outcome, fetchedAt: 1, via: VIA })).ok).toBe(true);
    }
  });
});

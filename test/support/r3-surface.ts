// Installed-engine answers over explicit disk seeds. Rebase request instance identities only, never answer payloads.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const REPO_ROOT = resolve(__dirname, '../..');
interface SurfaceJournalRow {
  seq: number; direction: string; at: string;
  frame: { type?: string; request_id?: string; request?: { subtype: string; component?: string; instance_id?: string }; response?: { request_id: string }; [key: string]: unknown };
}
export function recordedSurfaceSessionId(path: string): string {
  const rows = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as SurfaceJournalRow);
  const id = rows.find((row) => row.frame.event === 'provenance')?.frame.pinnedSessionId;
  if (typeof id !== 'string' || !id) throw new Error(`Missing pinned session id in ${path}`);
  return id;
}

export function recordedSurfaceJournal(root: string, fixture: string, selected?: { component: string; outcome: string; instanceId: string }): string {
  const rows = readFileSync(join(REPO_ROOT, 'spikes/protocol-probe/fixtures/pass3', `${fixture}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as SurfaceJournalRow);
  const renderIds = new Set(rows.filter((r) => r.direction === 'out' && r.frame.request?.subtype === 'ui_render').map((r) => r.frame.request_id));
  const selectedIds = new Set(rows.filter((r) => r.direction === 'out' && r.frame.request?.subtype === 'ui_render'
    && (!selected || (r.frame.request.component === selected.component && (r.frame.request.instance_id?.endsWith(`:${selected.outcome}`) || selected.outcome === 'unhooked')))).map((r) => r.frame.request_id));
  if (!selectedIds.size) throw new Error(`No recorded ${selected?.component} ${selected?.outcome} draw in ${fixture}`);
  const journal = rows.filter((r) => {
    if (!selected) return true;
    if (r.direction === 'out' && r.frame.request?.subtype === 'ui_render') return selectedIds.has(r.frame.request_id);
    if (r.direction === 'in' && r.frame.type === 'control_response' && renderIds.has(r.frame.response?.request_id)) return selectedIds.has(r.frame.response?.request_id);
    return true;
  }).map((row, index) => {
    const request = row.frame.request;
    if (row.direction === 'out' && request?.subtype === 'ui_render') {
      const instance = selected?.instanceId ?? request.instance_id;
      return { ...row, seq: index + 1, frame: { ...row.frame, request: { ...request, instance_id: instance } } };
    }
    return { ...row, seq: index + 1 };
  });
  const path = join(root, `${fixture}-dom.jsonl`);
  writeFileSync(path, journal.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}
// Control-only probes carry no resumed conversation frames. An active session snapshot comes from its journal,
// not the indexed disk file (engine-host/ipc.ts session.events). Supply explicitly synthetic echoes of our disk seed
// to that journal, leaving every recorded control request/answer and plugin notification unchanged.
export function addSurfaceSeedEchoes(path: string, records: Record<string, unknown>[]): void {
  const rows = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as SurfaceJournalRow);
  const initId = rows.find((row) => row.direction === 'out' && row.frame.request?.subtype === 'initialize')?.frame.request_id;
  const at = rows.findIndex((row) => row.direction === 'in' && row.frame.response?.request_id === initId);
  if (at < 0) throw new Error('Seed echoes need a recorded initialize answer');
  let lastUserUuid: unknown;
  const echoes: SurfaceJournalRow[] = [{ seq: 0, direction: 'meta', at: rows[at]!.at, frame: { event: 'e2e_synthetic_seed_echoes', description: 'Test-authored disk history echoed into the active replay journal; not an installed-engine recording' } }];
  for (const record of records) {
    const content = (record.message as { content?: unknown } | undefined)?.content;
    if (record.type === 'user' && (typeof content === 'string' || Array.isArray(content) && content.some((b: { type: string }) => b.type === 'text'))) lastUserUuid = record.uuid;
    const common = { session_id: record.sessionId, uuid: record.uuid, parent_tool_use_id: null };
    const frame = record.type === 'user' ? { ...common, type: 'user', isReplay: true, origin: { kind: 'human' }, message: record.message, ...(record.toolUseResult !== undefined ? { tool_use_result: record.toolUseResult } : {}) }
      : record.type === 'assistant' ? { ...common, type: 'assistant', message: record.message }
      : record.subtype === 'turn_duration' ? { ...common, type: 'result', subtype: 'success', is_error: false, duration_ms: record.durationMs, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], user_message_uuids: [lastUserUuid] }
      : null;
    if (frame) echoes.push({ seq: 0, direction: 'in', at: String(record.timestamp), frame });
  }
  rows.splice(at + 1, 0, ...echoes);
  writeFileSync(path, rows.map((row, index) => JSON.stringify({ ...row, seq: index + 1 })).join('\n') + '\n');
}

export const r3Question = { question: 'Which path?', header: 'Path', options: [{ label: 'One', description: 'First path' }, { label: 'Two', description: 'Second path' }], multiSelect: false };
export const r3Output = { stdout: 'R3', stderr: '', interrupted: false };
export const ownerMarkedText = 'Private working notes.\n<to-human>First **span**.</to-human>\n<essential>Second span.</essential>\n<need-input>Which path?\n<choice recommended>One</choice>\n<choice>Two</choice>\n</need-input>\nMore working notes.';
export function transcriptSeed(base: { repo: string; engineId: string }) {
  const records: Record<string, unknown>[] = [];
  let parent: string | null = null;
  const add = (type: string, uuid: string, fields: Record<string, unknown>) => {
    records.push({ type, uuid, parentUuid: parent, isSidechain: false, cwd: base.repo, sessionId: base.engineId, version: '2.1.287', timestamp: new Date(Date.UTC(2026, 9, 2, 6, 0, records.length)).toISOString(), ...fields });
    parent = uuid;
  };
  const user = (id: string, text: string) => add('user', id, { message: { role: 'user', content: text } });
  const assistant = (id: string, content: unknown[], stop = 'end_turn') => add('assistant', id, { message: { id: `api-${id}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content, stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } } });
  const text = (id: string, value: string) => assistant(id, [{ type: 'text', text: value }]);
  const tool = (id: string, name: string, input: unknown, output: unknown) => {
    assistant(`use-${id}`, [{ type: 'tool_use', id, name, input }], 'tool_use');
    add('user', `result-${id}`, { toolUseResult: output, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(output), is_error: false }] } });
  };
  const finish = (closed = true) => { if (closed) add('system', 'duration-r3', { subtype: 'turn_duration', durationMs: 1000 }); return records; };
  return { user, text, tool, finish };
}


export function sittingSeed(base: { repo: string; engineId: string }, closeTurns = false, headers = false): Record<string, unknown>[] {
  const rows = readFileSync(join(REPO_ROOT, 'spikes/protocol-probe/fixtures/pass3/mods-surface-sitting.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as SurfaceJournalRow);
  const records = rows.find((row) => row.frame.event === 'owner_session_seed')!.frame.records as Record<string, unknown>[];
  const drawn = headers ? new Map(readFileSync(join(REPO_ROOT, 'spikes/protocol-probe/fixtures/pass3/mods-surface-sitting-headers.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as SurfaceJournalRow).filter((row) => row.frame.event === 'display_hook_output').map((row) => [row.frame.uuid, row.frame.output])) : new Map();
  const seed: Record<string, unknown>[] = records.map((record) => ({ ...record, cwd: base.repo, sessionId: base.engineId, ...(drawn.has(record.uuid) && { message: { ...(record.message as object), content: [{ type: 'text', text: drawn.get(record.uuid) }] } }) }));
  if (!closeTurns) return seed;
  // The owner's file has no duration records. Explicit test-authored completions let its messages exercise the
  // streaming path without pretending that replay echoes themselves carry the original live lifecycle.
  const closed: Record<string, unknown>[] = [];
  let turn = 0;
  const finish = () => { const last = closed.at(-1)!; closed.push({ ...last, type: 'system', uuid: `sitting-replay-duration-${turn++}`, parentUuid: last.uuid, message: undefined, subtype: 'turn_duration', durationMs: 1000 }); };
  for (const record of seed) {
    const content = (record.message as { content?: unknown } | undefined)?.content;
    if (record.type === 'user' && typeof content === 'string' && closed.length) finish();
    closed.push(record);
  }
  finish();
  return closed;
}

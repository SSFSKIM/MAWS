// U12a's replay journals for e2e/computer-use.spec.ts (the UX wave's U12a execution document,
// docs/doperpowers/plans/2026-11-12-ux-wave-U12a-browser-computer-use-delivery.md, M5): a session MAWS runs whose agent
// drives the Mac through the computer-use plugin's `js` tool, played behind C3's handshake prelude under a session id
// of the case's own, as side-replay.ts builds its journals (the replay seam pins the id the spawn row names). The frames
// are the probes' own, re-addressed: the init of `pass2/auto-routed` (its MCP servers naming the plugin's, connected,
// so the session's status says computer use is there), a tool call and its result in the shapes of `pass3/steer-next`
// (the call named `mcp__plugin_cua_cua_repl__js`, its input a cell and its `timeout_ms`), the permission round of
// `permission` there, the assistant's text and the result of `pass2/bash-context-echoed`, and what the engine sends
// after an interrupt during an MCP call, copied from `pass3/p1-maws-ask-interrupt` (seq 95 to 107: the host's interrupt
// the replay holds at, its answer, the call's rejected result, the interruption marker, the result, the prompt's
// lifecycle and the idle state). The plugin's server is a stdio server of the engine's, so no `mcp_message` reaches
// MAWS for its calls. `get_status` after a result is left unrecorded: the replay answers it from the prelude.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './launch';
import { directStatus, PRELUDE_STATUS_ANSWER } from './side-replay';

type Row = { seq: number; direction: 'in' | 'out' | 'meta'; at: string; frame: Record<string, unknown> };
type Frame = Record<string, unknown>;

const FIXTURES = 'spikes/protocol-probe/fixtures';
const rowsOf = (path: string): Row[] =>
  readFileSync(join(REPO_ROOT, path), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Row);
const frameOf = (path: string, seq: number): Frame => structuredClone(rowsOf(path).find((row) => row.seq === seq)!.frame);

// Every string equal to a key of `swap` becomes its value, at any depth.
function swapped<T>(value: T, swap: Record<string, string>): T {
  if (typeof value === 'string') return (swap[value] ?? value) as T;
  if (Array.isArray(value)) return value.map((entry) => swapped(entry, swap)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, swapped(entry, swap)])) as T;
  return value;
}

const AUTO_ROUTED = `${FIXTURES}/pass2/auto-routed.jsonl`;
const ECHOED = `${FIXTURES}/pass2/bash-context-echoed.jsonl`;
const STEER_NEXT = `${FIXTURES}/pass3/steer-next.jsonl`;
const INTERRUPTED = `${FIXTURES}/pass3/p1-maws-ask-interrupt.jsonl`;
const READS = `${FIXTURES}/reads.jsonl`;

// The recorded ids each borrowed frame carries, re-addressed to the journal's.
const RECORDED = {
  init: { session: '9d753242-8280-4bb4-a144-501cf423d6a1', cwd: '/private/tmp/maws-probe2-Gcfvti' },
  echoed: { session: 'fd4c2f15-a381-402d-a125-a0f08a713e9c', prompt: 'a37362a6-a117-4985-b0f9-cae7bfad6114' },
  steer: { session: '4e220cb8-9e75-4d8a-b1a9-c37655666eac', prompt: 'fe091b0d-b28b-41a8-aed3-39585769623d' },
  interrupted: { session: 'b47c90c8-466d-4e73-a3fb-ebb3b72a71cd', prompt: 'b1449a29-518c-40d9-87f6-3951da4e857c', toolUse: 'toolu_01Rh1TG1yT1nQyYUri1vSxEC', request: 'qugvj6fu-6' },
} as const;

export const CUA_JS = 'mcp__plugin_cua_cua_repl__js'; // the plugin's `js` tool as the engine names it
const CUA_SERVER = 'plugin:cua:cua_repl';
const AT = '2026-11-12T12:00:00.000Z';

export class ComputerUseJournal {
  private readonly rows: Row[] = [];
  private readonly inputs = new Map<string, Frame>();
  private minted = 0;
  private initialised = false;

  // `sessionId` is what the seam pins (the spawn row) and the engine reports (`system/init`); `cwd` the init's directory.
  constructor(
    readonly sessionId: string,
    private readonly cwd: string,
  ) {
    this.push('meta', { event: 'provenance', charter: 'docs/charter.md', child: 'U12a', spec: 'docs/doperpowers/plans/2026-11-12-ux-wave-U12a-browser-computer-use-delivery.md', source: `test/fixtures/engine/replay-handshake.jsonl, ${AUTO_ROUTED}, ${STEER_NEXT}, ${ECHOED}, ${INTERRUPTED}, ${READS}`, note: 'Synthetic (U12a M5), built by e2e/support/computer-use-replay.ts for e2e/computer-use.spec.ts.' });
    for (const row of rowsOf('test/fixtures/engine/replay-handshake.jsonl')) this.push(row.direction, row.seq === PRELUDE_STATUS_ANSWER ? directStatus(row.frame) : row.frame);
    this.push('meta', { event: 'spawn', args: ['--session-id', sessionId], note: 'U12a M5: the pin the replay seam reads' });
  }

  private push(direction: Row['direction'], frame: Frame): void {
    this.rows.push({ seq: this.rows.length + 1, direction, at: AT, frame });
  }

  // A uuid of this journal's own (its second hex digit is the session id's last, so two journals never mint the same).
  private uuid(): string {
    this.minted += 1;
    return `c${this.sessionId.at(-1)}c40000-0000-4000-8000-${String(this.minted).padStart(12, '0')}`;
  }

  // A human prompt the replay holds at until MAWS writes one (matched by type), then the engine's `started`; the first
  // carries the session's `system/init` after it, as the engine sends it, with the plugin's server connected.
  prompt(): string {
    const uuid = this.uuid();
    this.push('out', { type: 'user', uuid, message: { role: 'user', content: '(written by MAWS)' }, parent_tool_use_id: null, origin: { kind: 'human' } });
    this.push('in', { type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: this.uuid(), session_id: this.sessionId });
    if (!this.initialised) {
      this.initialised = true;
      const init = swapped(frameOf(AUTO_ROUTED, 9), { [RECORDED.init.session]: this.sessionId, [RECORDED.init.cwd]: this.cwd });
      this.push('in', { ...init, permissionMode: 'default', mcp_servers: [{ name: CUA_SERVER, status: 'connected' }] });
    }
    return uuid;
  }

  // The assistant's call of the plugin's `js` tool: one cell, with the budget the plugin gives it. Answers its id.
  js(prompt: string, code: string, timeoutMs: number): string {
    const toolUseId = `toolu_01U12aCu${this.sessionId.at(-1)}${String(this.minted + 1).padStart(6, '0')}`;
    const input = { code, timeout_ms: timeoutMs };
    this.inputs.set(toolUseId, input);
    const call = swapped(frameOf(STEER_NEXT, 38), { [RECORDED.steer.session]: this.sessionId, [RECORDED.steer.prompt]: prompt }) as Frame & { message: Frame };
    const message = { ...call.message, id: `msg_e2e${this.uuid().replace(/-/g, '')}`, content: [{ type: 'tool_use', id: toolUseId, name: CUA_JS, input, caller: { type: 'direct' } }] };
    this.push('in', { ...call, uuid: this.uuid(), message, wire_tool_inputs: { [toolUseId]: input } });
    return toolUseId;
  }

  // The engine asks permission for the call (`can_use_tool` naming it), and the host's `allow` the replay holds at.
  asked(toolUseId: string): void {
    const requestId = this.uuid();
    const input = this.inputs.get(toolUseId)!;
    this.push('in', { type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: CUA_JS, display_name: 'js', input, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: CUA_JS }], behavior: 'allow', destination: 'localSettings' }], tool_use_id: toolUseId } });
    this.push('out', { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'allow' } } });
  }

  // The call's ordinary result: the cell's text, as an MCP tool's result is given.
  result(toolUseId: string, text: string): void {
    const recorded = swapped(frameOf(STEER_NEXT, 44), { [RECORDED.steer.session]: this.sessionId });
    this.push('in', { ...recorded, uuid: this.uuid(), message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content: [{ type: 'text', text }] }] }, tool_use_result: [{ type: 'text', text }] });
  }

  // A hold: the engine waits at a `get_context_usage` (reads.jsonl seq 56 and 57) until the test asks one
  // (`session.getContextUsage {detail: 'summary'}`), so the call stays in flight as long as the case needs.
  holdAtContextUsage(): void {
    const requestId = this.uuid();
    const request = frameOf(READS, 56).request as Frame;
    const response = (frameOf(READS, 57).response as { response: Frame }).response;
    this.push('out', { type: 'control_request', request_id: requestId, request });
    this.push('in', { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  // The person's Stop while the call runs: the composer's interrupt (`reason: user-cancel`, `cancel_queued: false`),
  // which the replay holds at, then what the engine sent after it in `pass3/p1-maws-ask-interrupt`: the interrupt's
  // answer, the call's error result marked `user-rejected`, the marker `[Request interrupted by user for tool use]`, the
  // turn's result, the prompt's `cancelled` and the idle state.
  interrupted(prompt: string, toolUseId: string): void {
    const swap = { [RECORDED.interrupted.session]: this.sessionId, [RECORDED.interrupted.prompt]: prompt, [RECORDED.interrupted.toolUse]: toolUseId, [RECORDED.interrupted.request]: this.uuid() };
    const frame = (seq: number) => swapped(frameOf(INTERRUPTED, seq), swap);
    this.push('out', frame(95));
    this.push('in', frame(99));
    for (const seq of [100, 101, 103, 106, 107]) this.push('in', { ...frame(seq), uuid: this.uuid() });
  }

  // The assistant's text and the turn's `result` carrying it, then the prompt's `completed`.
  reply(prompt: string, text: string): void {
    const swap = { [RECORDED.echoed.session]: this.sessionId, [RECORDED.echoed.prompt]: prompt };
    const assistant = swapped(frameOf(ECHOED, 26), swap) as Frame & { message: Frame };
    this.push('in', { ...assistant, uuid: this.uuid(), message: { ...assistant.message, id: `msg_e2e${this.uuid().replace(/-/g, '')}`, content: [{ type: 'text', text }] } });
    this.push('in', { ...swapped(frameOf(ECHOED, 30), swap), result: text, uuid: this.uuid(), user_message_uuid: prompt, user_message_uuids: [prompt] });
    this.push('in', { type: 'command_lifecycle', command_uuid: prompt, state: 'completed', uuid: this.uuid(), session_id: this.sessionId });
  }

  write(dir: string, name: string): string {
    const path = join(dir, `${name}.jsonl`);
    writeFileSync(path, this.rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    return path;
  }
}

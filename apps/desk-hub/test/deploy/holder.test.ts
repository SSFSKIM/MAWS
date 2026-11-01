// The holder's acceptance run (deploy/vm/holder.mjs, P5 O16 M4): the stub model's script for it (stub-model.mjs
// `holderStep`), which decides each main-loop request from the run's first message and the last assistant message alone.
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Step = { tool: { id: string; name: string; input: Record<string, unknown> } } | { text: string } | null;
type Turn = { blocks: Array<Record<string, unknown>>; stop: string };
// stub-model.mjs staged as the VM run stages it, beside spikes/protocol-probe's stub-api.mjs
async function load(): Promise<{ holderStep: (body: unknown) => Step; answer: (body: unknown) => Turn }> {
  const dir = mkdtempSync(join(tmpdir(), 'o16-stub-'));
  copyFileSync(join(import.meta.dirname, '../../deploy/vm/stub-model.mjs'), join(dir, 'stub-model.mjs'));
  copyFileSync(join(import.meta.dirname, '../../../../spikes/protocol-probe/stub-api.mjs'), join(dir, 'stub-api.mjs'));
  return (await import(join(dir, 'stub-model.mjs'))) as { holderStep: (body: unknown) => Step; answer: (body: unknown) => Turn };
}

const go = { role: 'user', content: [{ type: 'text', text: 'o16-holder go t1 120' }] };
const system = { role: 'system', content: 'a reminder the engine appends after the last user message' }; // 2.1.316 (M0)
const assistant = (id: string) => ({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] });
const result = (id: string, text: string) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] });

describe("the stub model's holder script", () => {
  it('runs the sleep in the background, then raises the permission, then ends the turn', async () => {
    const { holderStep } = await load();
    expect(holderStep({ messages: [go, system] })).toEqual({ tool: { id: 'toolu_o16_t1_bg', name: 'Bash', input: { command: 'sleep 120', run_in_background: true, description: 'o16 holder background sleep t1' } } });
    const afterShell = [go, assistant('toolu_o16_t1_bg'), result('toolu_o16_t1_bg', 'Command running in background with ID: b1'), system];
    expect(holderStep({ messages: afterShell })).toEqual({ tool: { id: 'toolu_o16_t1_ask', name: 'Bash', input: { command: 'curl -sS --max-time 2 http://127.0.0.1:9/o16-holder-t1', description: 'o16 holder permission t1' } } });
    const afterAsk = [...afterShell.slice(0, 3), assistant('toolu_o16_t1_ask'), result('toolu_o16_t1_ask', 'curl: (7) Failed to connect')];
    expect(holderStep({ messages: afterAsk })).toEqual({ text: 'o16-holder done t1' });
    expect(holderStep({ messages: afterAsk })).toEqual({ text: 'o16-holder done t1' }); // a repeated request, the same answer
  });

  it("is the turn the stub model answers a main-loop request of the run with", async () => {
    const { answer } = await load();
    expect(answer({ tools: [{ name: 'Bash' }], messages: [go, system] })).toEqual({ blocks: [{ type: 'tool_use', id: 'toolu_o16_t1_bg', name: 'Bash', input: { command: 'sleep 120', run_in_background: true, description: 'o16 holder background sleep t1' } }], stop: 'tool_use' });
    expect(answer({ tools: [{ name: 'Bash' }], messages: [go, assistant('toolu_o16_t1_ask'), result('toolu_o16_t1_ask', '7')] })).toEqual({ blocks: [{ type: 'text', text: 'o16-holder done t1' }], stop: 'end_turn' });
  });

  it("answers only the run's own shell's successful completion as notified", async () => {
    const { holderStep } = await load();
    const shell = result('toolu_o16_t1_bg', 'Command running in background with ID: b9ne8xniz. Output is being written to: /tmp/x/tasks/b9ne8xniz.output.');
    const ended = [go, assistant('toolu_o16_t1_bg'), shell, assistant('toolu_o16_t1_ask'), result('toolu_o16_t1_ask', '7'), { role: 'assistant', content: [{ type: 'text', text: 'o16-holder done t1' }] }];
    // the engine's notification (spikes/protocol-probe/fixtures/p5/p5-o16-holder-main-installed.jsonl)
    const note = (task: string, status: string) => ({ role: 'user', content: `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>toolu_o16_t1_bg</tool-use-id>\n<output-file>/tmp/x/tasks/${task}.output</output-file>\n<status>${status}</status>\n<summary>Background command</summary>\n</task-notification>` });
    expect(holderStep({ messages: [...ended, note('b9ne8xniz', 'completed'), system] })).toEqual({ text: 'o16-holder notified t1' });
    expect(holderStep({ messages: [...ended, note('b0therid0', 'completed')] })).toEqual({ text: 'o16-holder unrelated t1' }); // another task's
    expect(holderStep({ messages: [...ended, note('b9ne8xniz', 'failed')] })).toEqual({ text: 'o16-holder unrelated t1' });
    expect(holderStep({ messages: [...ended, note('b9ne8xniz', 'killed')] })).toEqual({ text: 'o16-holder unrelated t1' });
    expect(holderStep({ messages: [...ended, { role: 'user', content: 'an ordinary message' }] })).toEqual({ text: 'o16-holder unrelated t1' });
  });

  it('leaves every other conversation to the scene', async () => {
    const { holderStep } = await load();
    expect(holderStep({ messages: [{ role: 'user', content: 'o10-m11 ticks 3 abc' }] })).toBeNull();
    expect(holderStep({})).toBeNull();
  });
});

// ---- the driver's verdict (holder.mjs `verdict`) ---------------------------------------------------------------------

type Event = Record<string, unknown> & { kind: string; id: string };
type Verdict = { failures: string[]; counts: Record<string, number> };
const driver = async () => (await import(join(import.meta.dirname, '../../deploy/vm/holder.mjs'))) as { verdict: (run: unknown) => Verdict };

const APP = 'app-1';
const PROMPT = 'o16-holder go t1 120';
const PERMISSION = 'req-perm-1';
let seq = 0;
const ev = (kind: string, fields: Record<string, unknown> = {}): Event => ({ id: `${APP}:L1:${++seq}:0`, seq, kind, ...fields });
const ended = (fields: Record<string, unknown>) => ev('turn.ended', { result: 'success', isError: false, terminalReason: 'completed', isEchoReceipt: false, origin: 'human', userMessageUuids: [], ...fields });

// A run's stream as the passing VM run recorded it: the prompt, the permission raised once, one adoption's reconnect,
// the turn's result, then the shell's completion turn.
function stream(): Event[] {
  seq = 0;
  return [
    ev('user.message', { messageUuid: 'u-1', content: PROMPT, isReplay: false }),
    ev('turn.started', { userMessageUuid: 'u-1', origin: 'human' }),
    ev('permission.requested', { requestId: PERMISSION }),
    ev('session.reconnect', { phase: 'attempting', trigger: 'host_restart', attempt: 1 }),
    ev('session.reconnect', { phase: 'reconnected', trigger: 'host_restart', attempt: 1 }),
    ended({ userMessageUuids: ['u-1'], resultText: 'o16-holder done t1' }),
    ev('turn.started', { userMessageUuid: null, origin: 'engine' }),
    ended({ origin: 'task-notification', resultText: 'o16-holder notified t1' }),
  ];
}
const facts = () => ({
  mawsd: [10, 11, 12],
  engineHost: [20, 20, 21, 21],
  engineHostBuild: ['b-old', 'b-old', 'b-new'],
  sessions: [0, 1, 2, 3].map(() => ({ pid: 30, hostPid: 31, launchId: 'L1' })),
  shellAlive: true,
  cgroups: [true, true, true, true],
  killModes: ['process', 'process', 'process', 'process', 'process'],
});
const run = (over: { live?: Event[]; history?: Event[]; facts?: ReturnType<typeof facts> } = {}) => ({ tag: 't1', prompt: PROMPT, permission: PERMISSION, live: over.live ?? stream(), history: over.history ?? stream(), facts: over.facts ?? facts() });

describe("the holder driver's verdict", () => {
  it('passes the run the VM recorded', async () => {
    const { verdict } = await driver();
    const v = verdict(run());
    expect(v.failures).toEqual([]);
    expect(v.counts).toMatchObject({ results: 1, permissions: 1, notified: 1, hostRestarts: 1 });
  });

  it('fails two results for the original turn, one of them interrupted, whatever their text', async () => {
    const { verdict } = await driver();
    const twice = stream();
    twice.splice(5, 0, ended({ userMessageUuids: ['u-1'], result: 'error_during_execution', isError: true, terminalReason: 'aborted_streaming', resultText: null }));
    for (const v of [verdict(run({ live: twice })), verdict(run({ history: twice }))]) expect(v.failures.join('; ')).toMatch(/the original turn ended 2 times/);
  });

  it("fails an original turn whose one result is not the success", async () => {
    const { verdict } = await driver();
    const interrupted = stream().map((e) => (e.kind === 'turn.ended' && e.origin === 'human' ? { ...e, result: 'error_during_execution', isError: true, terminalReason: 'aborted_tools' } : e));
    expect(verdict(run({ live: interrupted })).failures.join('; ')).toMatch(/the original turn did not end in its success/);
  });

  it('fails a permission the live stream delivered twice, though the rebuilt history folds it to one', async () => {
    const { verdict } = await driver();
    const doubled = stream();
    doubled.splice(4, 0, ev('permission.requested', { requestId: PERMISSION })); // another event, the same request
    const v = verdict(run({ live: doubled }));
    expect(v.failures.join('; ')).toMatch(/live: the permission req-perm-1 was raised 2 times/);
  });

  it("fails a run whose completion turn is not the shell's (the stub's unrelated answer)", async () => {
    const { verdict } = await driver();
    const unrelated = stream().map((e) => (e.origin === 'task-notification' ? { ...e, resultText: 'o16-holder unrelated t1' } : e));
    expect(verdict(run({ live: unrelated, history: unrelated })).failures.join('; ')).toMatch(/the shell's completion reached the model 0 times/);
  });

  it('fails a KillMode other than process at any step', async () => {
    const { verdict } = await driver();
    const f = facts();
    f.killModes[2] = 'control-group';
    expect(verdict(run({ facts: f })).failures.join('; ')).toMatch(/KillMode/);
  });
});

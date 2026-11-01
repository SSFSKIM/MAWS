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

  it("answers the background shell's completion, a turn of its own, with the notified text", async () => {
    const { holderStep } = await load();
    const ended = [go, assistant('toolu_o16_t1_bg'), result('toolu_o16_t1_bg', 'b1'), assistant('toolu_o16_t1_ask'), result('toolu_o16_t1_ask', '7'), { role: 'assistant', content: [{ type: 'text', text: 'o16-holder done t1' }] }];
    expect(holderStep({ messages: [...ended, { role: 'user', content: '<task-notification><status>completed</status></task-notification>' }] })).toEqual({ text: 'o16-holder notified t1' });
  });

  it('leaves every other conversation to the scene', async () => {
    const { holderStep } = await load();
    expect(holderStep({ messages: [{ role: 'user', content: 'o10-m11 ticks 3 abc' }] })).toBeNull();
    expect(holderStep({})).toBeNull();
  });
});

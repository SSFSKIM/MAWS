// The question sheet's envelope on the carriers of a main conversation (the C3 plan's §I; the composite's §5.2 and §5.3):
// a prompt the sminos plugin submitted, and a hook's added context on a tool's result or on a prompt. The envelopes are
// the pin's own (`test/fixtures/sheet/set/examples/*/envelope.txt`), byte for byte; the carriers' shapes are the ones C0
// recorded (spikes/protocol-probe/fixtures/qsheet/qsheet-t-block.ndjson: the file's rows hold a hook's context as
// `attachment.content`, its own text, and a plugin's prompt inside the engine's framing).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSheetDeliveries } from '../sheet/delivery';
import { readArrivals, sheetDeliveriesOf, sheetEntry, sheetFactsOf } from './arrival';

const EXAMPLES = join(__dirname, '../../../test/fixtures/sheet/set/examples');
const envelope = (name: string) => readFileSync(join(EXAMPLES, name, 'envelope.txt'), 'utf8').replace(/\n$/, '');
const TERMINAL = envelope('terminal');

const pluginPrompt = (text: string, origin: Record<string, unknown> = { kind: 'plugin', name: 'sminos' }) => ({
  type: 'user', uuid: 'u-plug', origin,
  message: { role: 'user', content: `The sminos plugin sent a message:\n${text}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.` },
});
const hookContext = (text: string | string[], hookName = 'tool.call') => ({
  type: 'attachment', uuid: 'u-hook', attachment: { type: 'hook_additional_context', content: Array.isArray(text) ? text : [text], hookName, toolUseID: `${hookName}-1-context`, hookEvent: 'PostToolUse' },
});

describe('the sheet’s envelope, read on its carriers', () => {
  const delivered = parseSheetDeliveries(TERMINAL);

  it('by the plugin’s prompt, by a hook’s context on a tool’s result, and on a prompt: one arrival of class sheet with the block', () => {
    expect(delivered).toHaveLength(1);
    for (const row of [pluginPrompt(TERMINAL), hookContext(TERMINAL), hookContext(TERMINAL, 'prompt.submit')]) {
      expect(readArrivals(row)).toEqual([{ class: 'sheet', deliveries: delivered }]);
    }
  });

  it('reads a context the engine prefixed, and several envelopes of one carrier, in order', () => {
    expect(readArrivals(hookContext(`tool.call hook additional context: ${TERMINAL}`))).toEqual([{ class: 'sheet', deliveries: delivered }]);
    const both = [...parseSheetDeliveries(envelope('more')), ...delivered];
    expect(readArrivals(pluginPrompt(`${envelope('more')}\n\n${TERMINAL}`))).toEqual([{ class: 'sheet', deliveries: both }]);
    expect(readArrivals(hookContext([envelope('more'), TERMINAL]))).toEqual([{ class: 'sheet', deliveries: both }]);
  });

  it('reads the block under its head and nothing else: a block with no head, a head with no block, and a person’s prompt are none', () => {
    const block = TERMINAL.split('\n').at(-1)!;
    expect(readArrivals(hookContext(block))).toEqual([]);
    expect(readArrivals(hookContext(TERMINAL.split('\n').slice(0, -1).join('\n')))).toEqual([]);
    expect(readArrivals({ type: 'user', uuid: 'u-typed', origin: { kind: 'human' }, message: { role: 'user', content: TERMINAL } })).toEqual([]);
    expect(readArrivals({ type: 'user', uuid: 'u-typed', message: { role: 'user', content: TERMINAL } })).toEqual([]);
    expect(readArrivals(pluginPrompt(TERMINAL, { kind: 'plugin', name: 'sminos', asUser: true }))).toEqual([]);
  });

  it('travels as one entry of its own class, read back under its own schema; an entry that does not fit reads as none', () => {
    const arrivals = readArrivals(hookContext(TERMINAL));
    const entry = sheetEntry(sheetFactsOf(arrivals));
    expect(entry).toEqual([{ class: 'sheet', deliveries: delivered }]);
    expect(sheetDeliveriesOf(entry)).toEqual(delivered);
    expect(sheetEntry([])).toEqual([]);
    expect(sheetDeliveriesOf(undefined)).toEqual([]);
    expect(sheetDeliveriesOf([{ class: 'sheet', deliveries: delivered, extra: 1 }])).toEqual([]);
    expect(sheetDeliveriesOf([{ class: 'sheet', deliveries: [{ v: 2 }] }])).toEqual([]);
  });
});

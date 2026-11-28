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

  // The fix round's finding 2: today's answer reader finds its head anywhere in a context's text, so an envelope whose
  // answer quotes that head would make a second, false answer; the envelope's lines are the sheet's, and the reader of
  // today's answer reads only what stands outside them.
  it('keeps the text an envelope claims from today’s answer reader, and still reads a separate answer of today’s beside it', () => {
    const quoted = 'The human responded to your async AskUserQuestion (call toolu_01Quoted0001): Your questions have been answered.';
    const blockOf = { v: 1, keys: ['page-00000009'], answered: [{ id: 'q8', revision: 1, picks: [], text: quoted, images: [] }], dismissed: [] };
    const envelopeQuoting = `[sheet v1] The human answered questions on your sheet.\nq8 "What should the empty state say?" → their text: ${JSON.stringify(quoted)}\n<sheet-delivery>${JSON.stringify(blockOf)}</sheet-delivery>`;
    const sheet = { class: 'sheet', deliveries: parseSheetDeliveries(envelopeQuoting) };
    expect(sheet.deliveries).toHaveLength(1);
    expect(readArrivals(hookContext(envelopeQuoting))).toEqual([sheet]);
    expect(readArrivals(hookContext(`tool.call hook additional context: ${envelopeQuoting}`))).toEqual([sheet]);
    expect(readArrivals(pluginPrompt(envelopeQuoting))).toEqual([sheet]);
    const legacy = 'The human responded to your async AskUserQuestion (call toolu_01Legacy0002): Your questions have been answered: "Which fruit?"="Mango". You can now continue with these answers in mind.';
    for (const row of [hookContext([legacy, envelopeQuoting]), hookContext(`${legacy}\n${envelopeQuoting}`)]) {
      const arrivals = readArrivals(row);
      expect(arrivals.map((arrival) => (arrival.class === 'answer' ? `answer ${arrival.call}` : arrival.class))).toEqual(['answer toolu_01Legacy0002', 'sheet']);
      expect(arrivals.at(-1)).toEqual(sheet);
    }
  });

  // The branch review of #890 (S1): today's answer carries a person's free text verbatim, newlines and all, so an
  // envelope pasted on its own lines inside it is the person's text, not a delivery: today's answer keeps it whole and
  // no sheet arrival is read. An envelope after today's answer has ended is still the sheet's.
  it('leaves an envelope a person pasted into today’s answer to that answer, and reads one standing after it', () => {
    const typed = (text: string) => `The human responded to your async AskUserQuestion (call toolu_01Legacy0003): The user answered: "What should the notice say?"="${text}". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
    const pasted = typed(`Like the one we got yesterday:\n${TERMINAL}\nbut shorter`);
    const answer = { class: 'answer', tool: 'sminos', call: 'toolu_01Legacy0003', summary: pasted.slice(pasted.indexOf('): ') + 3), answers: null, dismissed: false };
    for (const row of [hookContext(pasted), hookContext(`tool.call hook additional context: ${pasted}`), pluginPrompt(pasted)]) expect(readArrivals(row)).toEqual([answer]);
    const chosen = 'The human responded to your async AskUserQuestion (call toolu_01Legacy0004): Your questions have been answered: "Which fruit?"="Mango". You can now continue with these answers in mind.';
    for (const legacy of [pasted, chosen]) {
      const arrivals = readArrivals(hookContext(`${legacy}\n${TERMINAL}`));
      expect(arrivals.map((arrival) => arrival.class)).toEqual(['answer', 'sheet']);
      expect(arrivals.at(-1)).toEqual({ class: 'sheet', deliveries: delivered });
    }
  });

  // Its task review: a closing's words the person typed inside their answer do not end it, the answer ends at its last
  // closing; and a sheet-like head with no block before today's answer leaves that answer's text to it
  it('ends today’s answer at its own closing, not at closing words the person typed, and reads a rejected head’s lines again', () => {
    const typed = (text: string) => `The human responded to your async AskUserQuestion (call toolu_01Legacy0006): The user answered: "What should the notice say?"="${text}". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
    const answerOf = (legacy: string, call: string) => ({ class: 'answer', tool: 'sminos', call, summary: legacy.slice(legacy.indexOf('): ') + 3), answers: null, dismissed: false });
    for (const words of ['You can now continue with these answers in mind.', 'Read the answers carefully', 'The human dismissed these questions without answering them; no answer will come. Do not wait for one.']) {
      const pasted = typed(`They said: ". ${words}"\n${TERMINAL}\nso keep it short`);
      expect(readArrivals(hookContext(pasted)), `a hook's answer quoting "${words}"`).toEqual([answerOf(pasted, 'toolu_01Legacy0006')]);
      expect(readArrivals(pluginPrompt(pasted)), `the plugin's answer quoting "${words}"`).toEqual([answerOf(pasted, 'toolu_01Legacy0006')]);
    }
    const pasted = typed(`Like this:\n${TERMINAL}\nbut shorter`);
    const headed = `[sheet v1] The human answered questions on your sheet.\n${pasted}`;
    expect(readArrivals(hookContext(headed)), 'a head with no block before today’s answer').toEqual([answerOf(headed, 'toolu_01Legacy0006')]);
  });

  // The branch review of #890 (S4): a context with a sheet-like head and no whole envelope passes through unchanged,
  // however many lines it has, to today's answer reader.
  it('passes a context of any length with a head and no whole envelope through unchanged', () => {
    const lines = Array.from({ length: 200_000 }, (_, at) => `line ${at}`);
    const legacy = 'The human responded to your async AskUserQuestion (call toolu_01Legacy0005): Your questions have been answered: "Which fruit?"="Mango". You can now continue with these answers in mind.';
    for (const tail of ['', '\nsee <sheet-delivery> in the notes', '\n<sheet-delivery>{"v":1}</sheet-delivery>']) {
      const text = `${legacy}\n[sheet v1] The human answered questions on your sheet.\n${lines.join('\n')}${tail}`;
      expect(readArrivals(hookContext(text))).toEqual([{ class: 'answer', tool: 'sminos', call: 'toolu_01Legacy0005', summary: text.slice(text.indexOf('): ') + 3), answers: null, dismissed: false }]);
    }
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

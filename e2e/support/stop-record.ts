// UX wave U1b, probe 9b (spikes/protocol-probe/findings-uxwave-u1b-message-and-stop-while-asked.txt; sminos 1.47.0, engine
// 2.1.322): a terminal session's Stop while its sminos asynchronous question waits, then the question answered or
// dismissed (`fixtures/uxwave/u1b-askwait-stop-{answer,dismiss}-r2`, the runs whose record holds the bridge's lists).
// What `e2e:lane-a` stages from the record: the bridge's events (the turn's start, the question raised, the turn's end
// `aborted`, the settlement), its answer to the interrupt, and the conversation rows the session's file holds before the
// Stop, after it, and after the answer. Pure (it reads the two files and nothing else), so `test/support/stop-record.test.ts`
// checks the staging on both records; every piece it looks for that a record lacks fails naming what is missing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeRaised } from '../../test/support/fake-bridge';

export type FileRow = Record<string, unknown> & { type?: string; isMeta?: boolean; subtype?: string; origin?: { kind?: string }; message?: { content?: unknown } };
type Block = { type?: string; id?: string; name?: string; tool_use_id?: string; text?: string };
type BridgeEvent = Record<string, unknown>;

export interface StopRecord {
  call: string; // the question's call id, which is the bridge's request id (U1b's C17)
  raised: FakeRaised;
  question: { question: string; header: string };
  turn: BridgeEvent; // `turn` start
  aborted: BridgeEvent; // `turn` complete, reason `aborted`
  settled: { request: string; winner: 'web'; outcome: string; by: string };
  interrupted: { ok: unknown; result: unknown }; // the bridge's answer to the interrupt, without the command id
  answer: string | null; // the answer the delivery quotes ("<question>"="<answer>"); null when nothing was delivered
  before: FileRow[]; // the human prompt, the ask's call and result, the running Bash call
  afterStop: FileRow[]; // the interrupt's rows and the Bash call's result
  afterAnswer: FileRow[]; // the delivery and the reply; empty when nothing reached the session
}

const blocks = (row: FileRow): Block[] => (Array.isArray(row.message?.content) ? (row.message!.content as Block[]) : []);
// A row the transcript draws from: a person's or the agent's row (not one holding only thinking), or a system row with
// a subtype; the file's bookkeeping rows (queue operations, snapshots, request blobs, titles) are left out
export const conversation = (row: FileRow): boolean =>
  (row.type === 'user' || row.type === 'assistant' || (row.type === 'system' && row.subtype !== undefined)) && !(row.type === 'assistant' && blocks(row).every((b) => b.type === 'thinking'));

export function stopRecord(then: 'answer' | 'dismiss', root: string): StopRecord {
  const base = join(root, 'spikes/protocol-probe/fixtures/uxwave', `u1b-askwait-stop-${then}-r2`);
  const record = JSON.parse(readFileSync(`${base}.terminal.json`, 'utf8')) as { bridge?: { events?: BridgeEvent[]; answers?: { op: string; body: Record<string, unknown> }[] } };
  const file = readFileSync(`${base}.transcript.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as FileRow);
  const need = <T>(value: T | undefined | null, what: string): T => {
    if (value === undefined || value === null) throw new Error(`${base}: the record holds no ${what}`);
    return value;
  };
  const at = (match: (row: FileRow) => boolean, what: string, from = 0): number => {
    const index = file.findIndex((row, i) => i >= from && match(row));
    if (index < 0) throw new Error(`${base}.transcript.jsonl: no ${what}`);
    return index;
  };
  const events = need(record.bridge?.events, 'bridge events');
  const event = (match: (e: BridgeEvent) => boolean, what: string): BridgeEvent =>
    Object.fromEntries(Object.entries(need(events.find(match), what)).filter(([key]) => !['ms', 'n', 't'].includes(key))); // the record's clock and count

  const raised = event((e) => e.type === 'raised', '`raised` event');
  const call = String(need(raised.request as string | undefined, 'request id on the `raised` event'));
  const questions = (raised.input as { questions?: { question: string; header: string }[] } | undefined)?.questions;
  const question = need(questions?.[0], 'question on the `raised` event');
  const turn = event((e) => e.type === 'turn' && e.phase === 'start', '`turn` start event');
  const aborted = event((e) => e.type === 'turn' && e.phase === 'complete' && e.reason === 'aborted', '`turn` complete event with reason `aborted`');
  const settled = event((e) => e.type === 'settled' && e.request === call, `\`settled\` event for ${call}`) as unknown as StopRecord['settled'];
  const interrupt = need(record.bridge?.answers?.find((a) => a.op === 'interrupt'), 'answer to the interrupt');

  const prompt = at((row) => row.type === 'user' && typeof row.message?.content === 'string' && row.origin?.kind === 'human' && row.isMeta !== true, 'human prompt (a user row of origin human with text content)');
  const ask = at((row) => row.type === 'assistant' && blocks(row).some((b) => b.type === 'tool_use' && b.id === call), `assistant row calling ${call}`, prompt);
  at((row) => row.type === 'user' && blocks(row).some((b) => b.type === 'tool_result' && b.tool_use_id === call), `result of ${call}`, ask);
  const bash = at((row) => row.type === 'assistant' && blocks(row).some((b) => b.type === 'tool_use' && b.name === 'Bash'), 'Bash call after the ask', ask);
  const bashId = need(blocks(file[bash]!).find((b) => b.type === 'tool_use' && b.name === 'Bash')?.id, 'id on the Bash call');
  const bashResult = at((row) => row.type === 'user' && blocks(row).some((b) => b.type === 'tool_result' && b.tool_use_id === bashId), `result of the Bash call ${bashId}`, bash);
  const afterAnswer = file.slice(bashResult + 1).filter(conversation);
  const delivery = afterAnswer.find((row) => row.type === 'user' && row.origin?.kind === 'plugin');
  const answer = delivery === undefined ? null : need(/="([^"]+)"/.exec(String(delivery.message?.content ?? ''))?.[1], 'answer quoted by the delivery ("<question>"="<answer>")');

  return {
    call,
    raised: Object.fromEntries(Object.entries(raised).filter(([key]) => key !== 'type')) as unknown as FakeRaised,
    question,
    turn,
    aborted,
    settled,
    interrupted: { ok: interrupt.body.ok, result: interrupt.body.result },
    answer,
    before: [file[prompt]!, ...file.slice(ask, bash + 1).filter(conversation)],
    afterStop: file.slice(bash + 1, bashResult + 1).filter(conversation),
    afterAnswer,
  };
}

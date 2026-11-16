// The web plugin's two recorded fetches (UX wave U3b, M5; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-
// find.md, Engine facts 11; spikes/protocol-probe/findings-uxwave-u3b-webfetch.txt): one with a prompt (seq 72, its
// result 76) and one without (seq 156, its result 158) of `uxwave/u3b-webfetch-r1.jsonl`, read from the journal so the
// tests hold the shapes the engine sent, never hand-written ones. `asWebFetch` gives the same call under the engine's
// own tool name, so each assertion about the plugin's fetch can stand beside the same one for `WebFetch`.
import { loadUxwaveJournal } from './fixtures';

export const WEB_FETCH_JOURNAL = 'u3b-webfetch-r1';

export interface RecordedCall {
  readonly form: 'with a prompt' | 'without a prompt';
  readonly toolUseId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly result: string; // the tool_result block's content: a plain string (Engine facts 11)
}

type Block = { type?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; content?: unknown };
const blocksAt = (seq: number): Block[] => {
  const row = loadUxwaveJournal(WEB_FETCH_JOURNAL).find((r) => r.seq === seq && r.direction === 'in');
  const content = (row?.frame as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (!Array.isArray(content)) throw new Error(`${WEB_FETCH_JOURNAL} seq ${seq} holds no message content`);
  return content as Block[];
};

function callAt(form: RecordedCall['form'], useSeq: number, resultSeq: number): RecordedCall {
  const use = blocksAt(useSeq).find((block) => block.type === 'tool_use');
  if (!use || typeof use.id !== 'string' || typeof use.name !== 'string') throw new Error(`${WEB_FETCH_JOURNAL} seq ${useSeq} holds no tool_use`);
  const result = blocksAt(resultSeq).find((block) => block.type === 'tool_result' && block.tool_use_id === use.id);
  if (!result || typeof result.content !== 'string') throw new Error(`${WEB_FETCH_JOURNAL} seq ${resultSeq} holds no string result for ${use.id}`);
  return { form, toolUseId: use.id, toolName: use.name, input: use.input as Record<string, unknown>, result: result.content };
}

export const recordedWebFetches = (): readonly [RecordedCall, RecordedCall] => [callAt('with a prompt', 72, 76), callAt('without a prompt', 156, 158)];

export const asWebFetch = (call: RecordedCall): RecordedCall => ({ ...call, toolName: 'WebFetch' });

/** Each recorded call, each beside its twin under `WebFetch`, as `[label, call]`. */
export const webFetchCases = (): [string, RecordedCall][] =>
  recordedWebFetches().flatMap((call) => [[`WebFetch ${call.form}`, asWebFetch(call)], [`${call.toolName} ${call.form}`, call]] as [string, RecordedCall][]);

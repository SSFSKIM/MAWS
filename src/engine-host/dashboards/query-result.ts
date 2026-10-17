// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the rows of a query's MCP result, before the
// host's one dataset parser reads them. The result is the tool's whole envelope (the recorded engine wire,
// spikes/p3-connectors/fixtures/engine-mcp-call.jsonl seqs 11 and 13: `content` a JSON string, `structuredContent` an
// object with its own `rows` array), and the rows are found in it by one closed rule, never by guessing a path:
//
// - `isError: true` is a failed tool, whatever else it carries;
// - `structuredContent`, when present, alone decides: an array, or an object with an own `rows` array (its other keys
//   are metadata and ignored); anything else there is refused, never read from the text instead;
// - without it, exactly one text: the wire's string `content`, or a `content` of one `text` block, whose JSON is one of
//   those two forms. Images, resources and several blocks are refused.
//
// The array alone is the snapshot (its JSON, never the envelope's); whether its records are flat and finite is the
// parser's to say. The problems are this module's own closed words, never the server's text.
export type QueryRows = { ok: true; rows: unknown[] } | { ok: false; problem: string };

export const QUERY_RESULT_PROBLEMS = {
  notAResult: 'the tool answered no MCP result',
  toolError: 'the tool reported an error',
  structured: 'its structured content is neither an array of rows nor an object with a rows array',
  content: 'its content is not one text block',
  notJson: 'its text is not JSON',
  shape: 'its JSON is neither an array of rows nor an object with a rows array',
} as const;

const refused = (problem: string): QueryRows => ({ ok: false, problem });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The two accepted forms: an array, or an object whose own `rows` is one.
function rowsIn(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Object.hasOwn(value, 'rows') && Array.isArray(value.rows)) return value.rows;
  return null;
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.length !== 1) return null;
  const [block] = content as unknown[];
  return isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : null;
}

export function queryRowsOf(envelope: unknown): QueryRows {
  if (!isRecord(envelope)) return refused(QUERY_RESULT_PROBLEMS.notAResult);
  if (envelope.isError === true) return refused(QUERY_RESULT_PROBLEMS.toolError);
  if (Object.hasOwn(envelope, 'structuredContent') && envelope.structuredContent !== undefined) {
    const rows = rowsIn(envelope.structuredContent);
    return rows ? { ok: true, rows } : refused(QUERY_RESULT_PROBLEMS.structured);
  }
  const text = textOf(envelope.content);
  if (text === null) return refused(QUERY_RESULT_PROBLEMS.content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refused(QUERY_RESULT_PROBLEMS.notJson);
  }
  const rows = rowsIn(parsed);
  return rows ? { ok: true, rows } : refused(QUERY_RESULT_PROBLEMS.shape);
}

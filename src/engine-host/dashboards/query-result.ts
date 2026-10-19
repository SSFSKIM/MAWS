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
// The array alone is the snapshot (its JSON, never the envelope's), an array of flat records. What the rows must be
// before anything serializes them for the parser is refused here, in the parser's own words, in either arm: a row that
// is no record, a nested cell (P3-F: one nested thousands deep would overflow the serializer's stack before the parser
// could refuse it), and a number no JSON can carry (JSON.parse reads 1e400 as Infinity; serialized, it would become a
// valid null cell, E3 M2 fix). The rest of the dataset's rules are the parser's. The problems are this module's own
// closed words, never the server's text.
export type QueryRows = { ok: true; rows: unknown[] } | { ok: false; problem: string };

export const QUERY_RESULT_PROBLEMS = {
  notAResult: 'the tool answered no MCP result',
  toolError: 'the tool reported an error',
  structured: 'its structured content is neither an array of rows nor an object with a rows array',
  content: 'its content is not one text block',
  notJson: 'its text is not JSON',
  shape: 'its JSON is neither an array of rows nor an object with a rows array',
  // the parser's wording for the same value in a JSON file (src/artifacts/dashboard/parse.ts), without its line
  nonfinite: (record: number, key: string) => `record ${record} holds a number in ${JSON.stringify(key)} too large to read`,
  notARecord: (record: number) => `record ${record} is not an object`, // P3-F
  nested: (record: number, key: string) => `record ${record} holds a nested value in ${JSON.stringify(key)}`, // P3-F
} as const;

const refused = (problem: string): QueryRows => ({ ok: false, problem });

// The rows, when each is a record whose own values are scalars JSON can carry: so serialized, they are at most two deep.
function flat(rows: unknown[]): QueryRows {
  for (const [r, record] of rows.entries()) {
    if (!isRecord(record)) return refused(QUERY_RESULT_PROBLEMS.notARecord(r + 1));
    for (const key of Object.keys(record)) {
      const cell = record[key];
      if (cell !== null && typeof cell === 'object') return refused(QUERY_RESULT_PROBLEMS.nested(r + 1, key));
      if (typeof cell === 'number' && !Number.isFinite(cell)) return refused(QUERY_RESULT_PROBLEMS.nonfinite(r + 1, key));
    }
  }
  return { ok: true, rows };
}

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
    return rows ? flat(rows) : refused(QUERY_RESULT_PROBLEMS.structured);
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
  return rows ? flat(rows) : refused(QUERY_RESULT_PROBLEMS.shape);
}

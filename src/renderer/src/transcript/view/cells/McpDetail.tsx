// An MCP call's detail: the server and tool, the result blocks (text through the shared markdown pipeline, inline data
// images, anything else as JSON), and a Raw toggle showing the input, result and structured content as JSON.
import type { ContentBlock } from '@shared/graph/events';
import { DETAIL } from '../../model/copy';
import type { Cell, CellDetail } from '../../model/rows';
import { useDisclosure } from '../context';
import { CappedMarkdown, Output } from './Truncated';

type Mcp = Extract<CellDetail, { kind: 'mcp' }>;

export const json = (value: unknown) => JSON.stringify(value, null, 2) ?? String(value);

// One result block: text as markdown, a base64 image inline, the rest as JSON.
export function ResultBlock({ block }: { block: ContentBlock }) {
  if (block.type === 'text' && typeof block.text === 'string') return <CappedMarkdown text={block.text} />;
  const source = typeof block.source === 'object' && block.source !== null ? (block.source as Record<string, unknown>) : null;
  if (block.type === 'image' && typeof source?.data === 'string') {
    return <img className="transcript-detail-image" src={`data:${String(source.media_type ?? 'image/png')};base64,${source.data}`} alt="" />;
  }
  const text = json(block);
  return <Output text={text} />;
}

export function McpDetail({ cell, detail }: { cell: Cell; detail: Mcp }) {
  const [raw, toggleRaw] = useDisclosure(`raw:${cell.id}`);
  const rawText = raw ? json({ input: detail.input, result: detail.result, structured: detail.structured }) : '';
  return (
    <div className="transcript-mcp">
      <div className="transcript-detail-heading">
        <span>
          {detail.server} · {detail.tool}
        </span>
        <button type="button" aria-pressed={raw} onClick={toggleRaw}>
          {DETAIL.raw}
        </button>
      </div>
      {raw ? (
        <Output text={rawText} />
      ) : typeof detail.result === 'string' ? (
        detail.result && <CappedMarkdown text={detail.result} />
      ) : (
        detail.result.map((block, i) => <ResultBlock key={i} block={block} />)
      )}
    </div>
  );
}

// An MCP call's detail: the server and tool, the result blocks (text through the shared markdown pipeline, inline data
// images, anything else as JSON), and a Raw toggle showing the input, result and structured content as JSON.
import type { ContentBlock } from '@shared/graph/events';
import { TRUNCATE_OVER } from '../../model/cells';
import { DETAIL } from '../../model/copy';
import type { Cell, CellDetail } from '../../model/rows';
import { useDisclosure } from '../context';
import { CappedMarkdown, Omitted, Output } from './Truncated';

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

// What a block puts into the DOM: its text, or its JSON; an inline image is an attribute, bounded by its own box.
const sizeOf = (block: ContentBlock) => (block.type === 'text' && typeof block.text === 'string' ? block.text.length : block.type === 'image' ? 0 : json(block).length);

// A result made of blocks, bounded as a whole (residue *Bounded surfaces and truncation*): blocks render until the
// 64 KB budget is spent (the first always, capped on its own), then one omitted marker with Open full log. The full
// result stays on the cell for copy and the full log.
export function ResultBlocks({ cell, blocks }: { cell: Cell; blocks: ContentBlock[] }) {
  let used = 0;
  let shown = 0;
  for (const block of blocks) {
    const size = sizeOf(block);
    if (shown > 0 && used + size > TRUNCATE_OVER) break;
    used += size;
    shown += 1;
  }
  const omitted = blocks.slice(shown).reduce((bytes, block) => bytes + sizeOf(block), 0);
  return (
    <>
      {blocks.slice(0, shown).map((block, i) => (
        <ResultBlock key={i} block={block} />
      ))}
      {shown < blocks.length && <Omitted cell={cell} text={DETAIL.omitted(omitted)} />}
    </>
  );
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
        <ResultBlocks cell={cell} blocks={detail.result} />
      )}
    </div>
  );
}

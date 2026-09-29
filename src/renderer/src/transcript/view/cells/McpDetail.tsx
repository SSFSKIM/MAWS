// An MCP call's detail: the server and tool, the result blocks (text through the shared markdown pipeline, inline data
// images, anything else as JSON), and a Raw toggle showing the input, result and structured content as JSON.
import type { ContentBlock } from '@shared/graph/events';
import { partsTruncationOf } from '../../model/cells';
import { DETAIL } from '../../model/copy';
import type { Cell, CellDetail } from '../../model/rows';
import { useDisclosure } from '../context';
import { isRead, spilledOr, SpillLoader } from './Spill';
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

// A result made of blocks, bounded as a whole (residue *Bounded surfaces and truncation*): past the 64 KB budget, the
// head blocks and the tail blocks (`partsTruncationOf`, each block capped on its own) around one omitted marker with
// Open full log. The full result stays on the cell for copy and the full log.
export function ResultBlocks({ cell, blocks }: { cell: Cell; blocks: ContentBlock[] }) {
  const sizes = blocks.map(sizeOf);
  const cut = partsTruncationOf(sizes);
  if (!cut) return blocks.map((block, i) => <ResultBlock key={i} block={block} />);
  const tailFrom = blocks.length - cut.tail;
  const omitted = sizes.slice(cut.head, tailFrom).reduce((bytes, size) => bytes + size, 0);
  return (
    <>
      {blocks.slice(0, cut.head).map((block, i) => (
        <ResultBlock key={i} block={block} />
      ))}
      {tailFrom > cut.head && <Omitted cell={cell} text={DETAIL.omitted(omitted)} />}
      {blocks.slice(tailFrom).map((block, i) => (
        <ResultBlock key={tailFrom + i} block={block} />
      ))}
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
      ) : isRead(detail.spill) ? (
        <Output text={spilledOr(detail.spill, '')} />
      ) : typeof detail.result === 'string' ? (
        detail.result && <CappedMarkdown text={detail.result} />
      ) : (
        <ResultBlocks cell={cell} blocks={detail.result} />
      )}
      {detail.spill && !raw && <SpillLoader cell={cell} spill={detail.spill} />}
    </div>
  );
}

// Any other tool's detail: its input as JSON and its result (text, or the blocks), both bounded.
import { resultText } from '../../model/cells';
import { DETAIL } from '../../model/copy';
import type { Cell, CellDetail } from '../../model/rows';
import { json, ResultBlocks } from './McpDetail';
import { isRead, spilledOr, SpillLoader } from './Spill';
import { Output } from './Truncated';

type Generic = Extract<CellDetail, { kind: 'generic' }>;

export function GenericDetail({ cell, detail }: { cell: Cell; detail: Generic }) {
  const input = json(detail.input);
  const onlyText = typeof detail.result === 'string' || detail.result.every((block) => block.type === 'text');
  const result = onlyText ? resultText(detail.result) : null;
  return (
    <div className="transcript-generic" data-error={detail.isError ? '' : undefined}>
      <div className="transcript-detail-label">{DETAIL.input}</div>
      <Output text={input} />
      <div className="transcript-detail-label">{DETAIL.result}</div>
      {isRead(detail.spill) ? (
        <Output text={spilledOr(detail.spill, '')} className={detail.isError ? 'transcript-stderr' : undefined} />
      ) : result !== null ? (
        result && <Output text={result} className={detail.isError ? 'transcript-stderr' : undefined} />
      ) : (
        <ResultBlocks cell={cell} blocks={detail.result as Exclude<Generic['result'], string>} />
      )}
      {detail.spill && <SpillLoader cell={cell} spill={detail.spill} />}
    </div>
  );
}

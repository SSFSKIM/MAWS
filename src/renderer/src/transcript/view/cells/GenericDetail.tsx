// Any other tool's detail: its input as JSON and its result (text, or the blocks), both bounded.
import { resultText, truncationOf } from '../../model/cells';
import { DETAIL } from '../../model/copy';
import type { CellDetail } from '../../model/rows';
import { json, ResultBlock } from './McpDetail';
import { Output } from './Truncated';

type Generic = Extract<CellDetail, { kind: 'generic' }>;

export function GenericDetail({ detail }: { detail: Generic }) {
  const input = json(detail.input);
  const onlyText = typeof detail.result === 'string' || detail.result.every((block) => block.type === 'text');
  const result = onlyText ? resultText(detail.result) : null;
  return (
    <div className="transcript-generic" data-error={detail.isError ? '' : undefined}>
      <div className="transcript-detail-label">{DETAIL.input}</div>
      <Output text={input} truncation={truncationOf(input)} />
      <div className="transcript-detail-label">{DETAIL.result}</div>
      {result !== null ? (
        result && <Output text={result} truncation={detail.truncated} className={detail.isError ? 'transcript-stderr' : undefined} />
      ) : (
        (detail.result as Exclude<Generic['result'], string>).map((block, i) => <ResultBlock key={i} block={block} />)
      )}
    </div>
  );
}

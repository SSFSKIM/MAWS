// A settings or plugin hook's detail: its event and name, the outcome with the exit code, and what it printed.
import { DETAIL } from '../../model/copy';
import type { CellDetail } from '../../model/rows';
import { Output } from './Truncated';

type Hook = Extract<CellDetail, { kind: 'hook' }>;

export function HookDetail({ detail }: { detail: Hook }) {
  return (
    <div className="transcript-hook">
      <div className="transcript-detail-heading">
        <span>
          {detail.event} · {detail.name}
        </span>
        <span data-outcome={detail.outcome}>{DETAIL.hookOutcome(detail.outcome, detail.exitCode)}</span>
      </div>
      {detail.stdout && <Output text={detail.stdout} />}
      {detail.stderr && <Output text={detail.stderr} className="transcript-stderr" />}
    </div>
  );
}

// THROWAWAY (deleted in M3 with prototype-model.ts): the anchoring spike's row renderer. Plain components over X3 rows,
// sized like the real rows will be (markdown answers through the real Markdown wrapper, expandable groups with a
// bounded scroller and cell details), so G1 measures the list and the markdown stack. Tokens only.
import { useSyncExternalStore } from 'react';
import type { Cell, Row } from '../transcript/model/rows';
import { Markdown } from '../transcript/view/markdown/Markdown';
import type { PrototypeTranscript } from './prototype-model';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
interface Props<K extends Row['kind']> {
  row: RowOf<K>;
  model: PrototypeTranscript;
}

const COLUMN = 'mx-auto w-full max-w-[var(--measure)] px-6';

export function renderPrototypeRow(model: PrototypeTranscript, row: Row) {
  const turn = model.turnNumber(row.turnId) ?? undefined;
  return (
    <div data-turn={turn} data-kind={row.kind} className={COLUMN}>
      {body(model, row)}
    </div>
  );
}

function body(model: PrototypeTranscript, row: Row) {
  switch (row.kind) {
    case 'time':
      return <div role="separator" className="py-4 text-center text-ui-sm text-fg-faint">{row.label}</div>;
    case 'user':
      return (
        <div className="flex justify-end py-3">
          <div className="max-w-[85%] whitespace-pre-wrap rounded-lg border border-border bg-bg-raised px-3 py-2 font-prose text-prose text-fg">{row.text}</div>
        </div>
      );
    case 'divider':
      return <Divider row={row} model={model} />;
    case 'thinking':
      return <div className="py-1 text-ui text-fg-muted">{row.live ? 'Thinking' : 'Thought'}</div>;
    case 'assistant_text':
      return <Text row={row} model={model} />;
    case 'group':
      return <Group row={row} model={model} />;
    case 'subagent':
      return <div className="py-1 text-ui text-fg-muted">◆ {row.sentence}</div>;
    case 'receipt':
      return (
        <div className="my-2 rounded-lg border border-border bg-bg-raised px-3 py-2 text-ui">
          <div className="text-fg">
            {row.files.length} files changed · <span className="text-success">+{row.added}</span> <span className="text-danger">−{row.removed}</span>
          </div>
          {row.files.slice(0, 3).map((file) => (
            <div key={file.cellId} className="font-mono text-ui-sm text-fg-muted">{file.path}</div>
          ))}
        </div>
      );
    case 'boundary':
      return <div className="py-2 text-center text-ui-sm text-fg-faint">{row.text}</div>;
    default:
      return <div className="py-1 text-ui-sm text-fg-faint">{row.kind}</div>;
  }
}

function Divider({ row, model }: Props<'divider'>) {
  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      className="w-full border-b border-border py-2 text-left text-ui text-fg-muted hover:text-fg"
      onClick={() => model.toggleTurn(row.turnId!)}
    >
      {model.dividerLabel(row)} {row.expanded ? '▾' : '▸'}
    </button>
  );
}

function Text({ row, model }: Props<'assistant_text'>) {
  const liveText = useSyncExternalStore(
    (listener) => model.subscribeLive(row.id, listener),
    () => (row.live ? model.liveText(row.id) : null),
  );
  const answer = row.phase === 'answer';
  return (
    <div className={answer ? 'py-3 font-prose text-prose text-fg' : 'py-1 text-ui text-fg-muted'}>
      <Markdown markdown={liveText ?? row.markdown} live={row.live} />
    </div>
  );
}

function Group({ row, model }: Props<'group'>) {
  return (
    <div className="py-0.5">
      <button type="button" aria-expanded={row.expanded} className="w-full py-1 text-left text-ui text-fg-muted hover:text-fg" onClick={() => model.toggleGroup(row.id, row.turnId!)}>
        {row.summary} {row.expanded ? '▾' : '▸'}
      </button>
      {row.expanded && (
        <div className="max-h-[224px] overflow-y-auto rounded-md border border-border bg-bg-raised [overscroll-behavior:contain]">
          {row.cells.map((cell) => (
            <CellLine key={cell.id} cell={cell} turn={row.turnId!} model={model} />
          ))}
        </div>
      )}
    </div>
  );
}

function CellLine({ cell, turn, model }: { cell: Cell; turn: NonNullable<Row['turnId']>; model: PrototypeTranscript }) {
  const result = cell.detail.kind === 'generic' ? cell.detail.result : '';
  return (
    <div data-cell-id={cell.id} data-expanded={cell.expanded || undefined}>
      <button type="button" aria-expanded={cell.expanded} className="w-full truncate px-3 py-1 text-left font-mono text-ui-sm text-fg hover:bg-bg-hover" onClick={() => model.toggleCell(cell.id, turn)}>
        {cell.status === 'denied' ? 'Denied: ' : ''}
        {cell.label}
      </button>
      {cell.expanded && (
        <pre className="mx-3 mb-2 max-h-[144px] overflow-auto whitespace-pre-wrap rounded-sm bg-bg px-2 py-1 font-mono text-ui-sm text-fg-muted">
          {typeof result === 'string' ? result : JSON.stringify(result)}
        </pre>
      )}
    </div>
  );
}

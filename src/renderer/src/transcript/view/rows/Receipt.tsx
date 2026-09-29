// A turn's change receipt, after mockup 02: the file count and line counts, Review changes (C8's Review tool), the
// first three files (each opening Review at that file) with Show more, and Undo and Reapply over the RewindInterface.
// Undo asks `canUndo` once per receipt (the answer is kept in the store with the undo state, so a remount neither asks
// again nor forgets an undo); a refusal disables Undo with the reason as its tooltip; a null `reapply` hides Reapply.
import { Tooltip } from 'radix-ui';
import { useEffect } from 'react';
import { RECEIPT_APPLIED, useTranscriptStore, type ReceiptUndo } from '../../../stores/transcript';
import { RECEIPT } from '../../model/copy';
import type { Row, RowId, TurnId } from '../../model/rows';
import { useDisclosure, useTranscriptContext, type RewindInterface } from '../context';
import { FileIcon } from './icons';
import { LineCounts } from './parts';

type ReceiptRowData = Extract<Row, { kind: 'receipt' }>;
const SHOWN = 3;

export function ReceiptRow({ row }: { row: ReceiptRowData }) {
  const { actions, rewind } = useTranscriptContext();
  const [all, toggleAll] = useDisclosure(`files:${row.id}`);
  const turnId = row.turnId!;
  const files = all ? row.files : row.files.slice(0, SHOWN);
  return (
    <section className="transcript-receipt" aria-label="Change receipt">
      <div className="transcript-receipt-top">
        <FileIcon />
        <strong>
          {RECEIPT.heading(row.files.length)} · <LineCounts added={row.added} removed={row.removed} />
        </strong>
        <button type="button" className="transcript-receipt-review" onClick={() => actions.reviewChanges(turnId)}>
          {RECEIPT.review}
        </button>
      </div>
      <ul className="transcript-receipt-files">
        {files.map((file) => (
          <li key={file.path}>
            <button type="button" className="transcript-receipt-file" data-change={file.change} title={file.path} onClick={() => actions.reviewChanges(turnId, file.path)}>
              <span className="transcript-receipt-path">{file.path}</span>
              <LineCounts added={file.added} removed={file.removed} />
            </button>
          </li>
        ))}
      </ul>
      {row.files.length > SHOWN && (
        <button type="button" className="transcript-quiet-button transcript-receipt-more" onClick={toggleAll}>
          {all ? RECEIPT.collapse : RECEIPT.showMore(row.files.length - SHOWN)}
        </button>
      )}
      {rewind && <UndoControls rewind={rewind} turnId={turnId} receipt={row.id} />}
    </section>
  );
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function UndoControls({ rewind, turnId, receipt }: { rewind: RewindInterface; turnId: TurnId; receipt: RowId }) {
  const { storeKey } = useTranscriptContext();
  const undo: ReceiptUndo = useTranscriptStore((state) => state.entries[storeKey]?.state.ui.receipts.get(receipt)) ?? RECEIPT_APPLIED;
  const update = (patch: Partial<ReceiptUndo>) => useTranscriptStore.getState().setReceipt(storeKey, receipt, patch);

  useEffect(() => {
    if (undo.check !== null) return;
    const set = (patch: Partial<ReceiptUndo>) => useTranscriptStore.getState().setReceipt(storeKey, receipt, patch);
    const reapply = rewind.reapply !== null;
    set({ check: 'pending', reapply });
    rewind.canUndo(turnId).then(
      (answer) => set({ check: answer }),
      (error: unknown) => set({ check: { ok: false, reason: reasonOf(error) } }),
    );
  }, [undo.check, rewind, turnId, storeKey, receipt]);

  const run = async (call: (turn: TurnId) => Promise<void>, from: ReceiptUndo['state'], during: ReceiptUndo['state'], to: ReceiptUndo['state'], action: 'Undo' | 'Reapply') => {
    update({ state: during, error: null });
    try {
      await call(turnId);
      update({ state: to });
    } catch (error) {
      update({ state: from, error: RECEIPT.failed(action, reasonOf(error)) });
    }
  };

  const check = typeof undo.check === 'object' ? undo.check : null;
  const refused = check !== null && !check.ok ? check.reason : null;
  const undoButton = (
    <button type="button" className="transcript-button" disabled={undo.state !== 'applied' || check?.ok !== true} onClick={() => void run(rewind.undo, 'applied', 'undoing', 'undone', 'Undo')}>
      {RECEIPT.undo}
    </button>
  );
  const reapply = rewind.reapply;
  return (
    <div className="transcript-receipt-footer">
      <span className="transcript-receipt-state" data-error={undo.error ? '' : undefined}>
        {undo.error ?? RECEIPT.state[undo.state]}
      </span>
      {refused && undo.state === 'applied' ? (
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className="transcript-tooltip-trigger" tabIndex={0}>
                {undoButton}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="transcript-popover transcript-tooltip" side="top" sideOffset={4}>
                {refused}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      ) : (
        undoButton
      )}
      {reapply && (
        <button type="button" className="transcript-button" disabled={undo.state !== 'undone'} onClick={() => void run(reapply, 'undone', 'reapplying', 'applied', 'Reapply')}>
          {RECEIPT.reapply}
        </button>
      )}
    </div>
  );
}

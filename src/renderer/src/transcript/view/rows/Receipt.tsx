// A turn's change receipt, after mockup 02: the file count and line counts, Review changes (C8's Review tool), the
// first three files with Show more, and Undo and Reapply over the RewindInterface. A file row (W4, Codex's receipt)
// reads its path relative to the session's directory; after 800 ms of hover a popover above it shows the turn's hunks
// for that file (every edit of it in the turn, from the turn's activity, so a folded turn has them too), up to 420 px
// tall with a scrolling body, gone on leave; a click on the row or the popover opens Review at that file, ⌘-click the
// file itself. Undo asks `canUndo` once per receipt (the answer is kept in the store with the undo state, so a remount
// neither asks again nor forgets an undo); a refusal disables Undo with the reason as its tooltip; a null `reapply`
// hides Reapply.
import { HoverCard, Tooltip } from 'radix-ui';
import { useEffect, type MouseEvent } from 'react';
import { RECEIPT_APPLIED, useTranscriptStore, type ReceiptUndo } from '../../../stores/transcript';
import { DETAIL, displayPath, RECEIPT } from '../../model/copy';
import type { ChangedFile, Row, RowId, TurnId } from '../../model/rows';
import { EditDiff } from '../cells/EditDetail';
import { useDisclosure, useTranscriptContext, type RewindInterface } from '../context';
import { FileIcon } from './icons';
import { LineCounts } from './parts';

type ReceiptRowData = Extract<Row, { kind: 'receipt' }>;
const SHOWN = 3;
const HOVER_MS = 800; // Codex's diff preview delay (r1-codex §6)

export function ReceiptRow({ row }: { row: ReceiptRowData }) {
  const { actions, rewind, storeKey, sessionDirectory } = useTranscriptContext();
  const [all, toggleAll] = useDisclosure(`files:${row.id}`);
  // The engine's own working directory first (its latest session.started or init), else the session record's.
  const directory = useTranscriptStore((s) => s.entries[storeKey]?.state.cwd ?? null) ?? sessionDirectory ?? null;
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
            <FileRow file={file} turnId={turnId} path={displayPath(file.path, directory)} />
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

function FileRow({ file, turnId, path }: { file: ChangedFile; turnId: TurnId; path: string }) {
  const { actions } = useTranscriptContext();
  const review = () => actions.reviewChanges(turnId, file.path);
  // ⌘-click opens the file itself (not a deleted one, which has nothing to open: Review shows its removal).
  const open = (event: MouseEvent) => (event.metaKey && file.change !== 'delete' ? actions.openFile(file.path) : review());
  return (
    <HoverCard.Root openDelay={HOVER_MS} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <button type="button" className="transcript-receipt-file" data-change={file.change} data-path={file.path} onClick={open}>
          <span className="transcript-receipt-path">{path}</span>
          <LineCounts added={file.added} removed={file.removed} />
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side="top" align="center" sideOffset={0} collisionPadding={8} className="transcript-popover transcript-receipt-hover" data-receipt-hover={file.path} onClick={review}>
          <FileDiff file={file} turnId={turnId} path={path} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

// The turn's hunks for one file: every completed edit of it in the turn, in order, from the turn's activity (which C6
// keeps whatever the reader disclosed); read only while the popover is open.
function FileDiff({ file, turnId, path }: { file: ChangedFile; turnId: TurnId; path: string }) {
  const { storeKey } = useTranscriptContext();
  const activity = useTranscriptStore((s) => s.activity(storeKey).find((turn) => turn.turnId === turnId) ?? null);
  const hunks = (activity?.files ?? []).flatMap((entry) => (entry.use === 'edited' && entry.edit?.filePath === file.path ? entry.edit.hunks : []));
  return (
    <>
      <div className="transcript-receipt-hover-header">
        <span className="transcript-receipt-path">{path}</span>
        <LineCounts added={file.added} removed={file.removed} />
      </div>
      {hunks.length === 0 ? <p className="transcript-detail-note">{DETAIL.noDiff}</p> : <EditDiff hunks={hunks} cell={null} />}
    </>
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

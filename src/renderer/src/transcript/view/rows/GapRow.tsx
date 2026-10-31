// The gap bar (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The gap bar"; acceptance 11): one row
// where a transcript's history has a hole, "Earlier history isn't available" (model/gap.ts says where it comes from). A
// quiet bar in the reading column, as the remote transcript's older-page bar (lane-a/view/RemoteTranscriptSlot.tsx): it
// tells, and offers nothing, since nothing can bring the events back.
import type { Row } from '../../model/rows';

export function GapRow({ row }: { row: Extract<Row, { kind: 'gap' }> }) {
  return (
    <div role="status" data-testid="history-gap" className="flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-ui-sm text-fg-muted">
      <span className="min-w-0 flex-1">{row.text}</span>
    </div>
  );
}

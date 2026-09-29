// A spilled result's loader (residue *Spilled results*): the engine wrote a result too large for the wire under
// `tool-results/`, and the detail shows the wire preview until the reader asks for the whole thing. The load goes
// through `actions.loadSpill` (by default fs.readSpill, up to the first 2 MB) and its state lives in the store, where
// the row reports it (`Spill.state`, `content`); the detail then shows the content with the same 64 KB cap as any
// output. Past what was read, the rest is Open full log's (C8).
import { useTranscriptStore } from '../../../stores/transcript';
import { SPILL } from '../../model/copy';
import type { Cell, Spill } from '../../model/rows';
import { SPILL_READ_BYTES } from '../../source/ipc';
import { useTranscriptContext } from '../context';
import { Omitted } from './Truncated';

// What a detail shows as the result: the loaded spill, else the wire preview.
export const spilledOr = (spill: Spill | null, preview: string) => (spill?.state === 'loaded' && spill.content !== null ? spill.content : preview);

export function SpillLoader({ cell, spill }: { cell: Cell; spill: Spill }) {
  const { storeKey, actions } = useTranscriptContext();
  const error = useTranscriptStore((state) => state.entries[storeKey]?.state.ui.spills.get(spill.path)?.error ?? null);
  const load = () => {
    const set = useTranscriptStore.getState().setSpill;
    set(storeKey, spill.path, { state: 'loading', error: null });
    actions.loadSpill(spill).then(
      (content) => set(storeKey, spill.path, { state: 'loaded', content }),
      (reason: unknown) => set(storeKey, spill.path, { state: 'failed', content: null, error: reason instanceof Error ? reason.message : String(reason) }),
    );
  };
  switch (spill.state) {
    case 'not_loaded':
      return (
        <div className="transcript-spill">
          <button type="button" onClick={load}>
            {SPILL.load(spill.bytes)}
          </button>
        </div>
      );
    case 'loading':
      return (
        <div className="transcript-spill" role="status">
          {SPILL.loading}
        </div>
      );
    case 'failed':
      return (
        <div className="transcript-spill" data-error="">
          <span>{SPILL.failed(error ?? '')}</span>
          <button type="button" onClick={load}>
            {SPILL.retry}
          </button>
        </div>
      );
    case 'loaded':
      return spill.bytes !== null && spill.bytes > SPILL_READ_BYTES ? <Omitted cell={cell} text={SPILL.head(SPILL_READ_BYTES)} /> : null;
  }
}

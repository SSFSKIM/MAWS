// A thinking block as a row (in a turn without tools, or beside work that is not a run) and as a thought line inside a
// run: a disclosure reading the live thinking label while it streams (W8: the CLI's tier, effort and time, under Codex's
// shimmer) and `Thought for {t}` after, its text bounded when open. A thought with no text has nothing to open: its
// label starts where a line with a chevron starts its label (UX wave U2, decision 12). A completed block with no text
// has no row outside a run (derive.ts, groups.ts: W1).
import { liveBlockBuffer, useTranscriptStore } from '../../../stores/transcript';
import { DisclosureBody } from '../../../ui/disclosure';
import { thinkingLabel } from '../../model/copy';
import { joinThoughts } from '../../model/groups';
import type { Row, TurnId } from '../../model/rows';
import { useDisclosure, useTranscriptContext } from '../context';
import { Chevron } from './parts';
import { LiveThinkingLabel } from './ThinkingLabel';

// UX wave U2 (O-27; the U2a document, M4 "One component, two identities", Interfaces §C): `id` keys the disclosure (a
// row's own id; a run's line, its first member's cell id); `live`, while a member streams, is that member's block
// identity and start, which key the store's buffer and the label's clock. `text` is what has settled; while live the
// streaming member's buffer follows it as it grows (`fallback` where the store holds no buffer for the block, as for
// lane A's overlay row). `ms` is the time the label reads: inside a run the recorded one, outside it the row's.
export interface ThoughtLineProps {
  id: string;
  turnId: TurnId | null;
  live: { block: string; at: string } | null;
  text: string;
  fallback?: string;
  ms: number | null;
  clock?: 'events' | 'wall';
}

export function ThoughtLine({ id, turnId, live, text, fallback = '', ms, clock }: ThoughtLineProps) {
  const { storeKey } = useTranscriptContext();
  const buffer = useTranscriptStore((state) => (live !== null && turnId !== null ? liveBlockBuffer(state.entries[storeKey], turnId, live.block) : null));
  const [open, toggle] = useDisclosure(id);
  const shown = live !== null ? joinThoughts([text, buffer ?? fallback]) : text;
  const label = live !== null ? <LiveThinkingLabel startedAt={live.at} clock={clock} /> : thinkingLabel(false, ms);
  if (shown.trim() === '') {
    return (
      <div className="transcript-thinking">
        <span className="transcript-disclosure"><span className="transcript-chevron" aria-hidden="true" />{label}</span>
      </div>
    );
  }
  return (
    <div className="transcript-thinking">
      <button type="button" className="transcript-disclosure" aria-expanded={open} onClick={toggle}>
        <Chevron />
        {label}
      </button>
      <DisclosureBody open={open}>
        <div className="transcript-thinking-text">{shown}</div>
      </DisclosureBody>
    </div>
  );
}

export function ThinkingRow({ row }: { row: Extract<Row, { kind: 'thinking' }> }) {
  const live = row.live ? { block: row.id.slice(row.id.indexOf(':') + 1), at: row.at } : null;
  return <ThoughtLine id={row.id} turnId={row.turnId} live={live} text={row.live ? '' : row.text} fallback={row.text} ms={row.durationMs} clock={row.clock} />;
}

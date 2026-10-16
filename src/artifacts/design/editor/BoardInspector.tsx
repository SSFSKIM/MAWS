// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3): the inspector's board section, shown above
// C's inspector whenever no element is selected (the board's geometry, as against its content): its name, X, Y, width
// and height, and a size preset. C's own number field draws each value (the same look, Enter and arrow steps, the
// refusal shown inline); a frame the model refuses is named there and nothing is written, never adjusted. A held or
// missing board, or a read-only replica, shows its values without offering a write.
import { useMemo, useState } from 'react';
import type { DeckSession } from '../../slides/editor/session';
import { InspectorContext, NumberField, Refusal, Row, Section, type InspectorApi } from '../../slides/editor/inspector/fields';
import { FRAME_KEYS, type BoardFrame } from '../canvas';
import { writeBoardEntry } from '../model';
import { BoardError, setBoardFrame } from '../writers';
import { boardLabel, type BoardView } from './boards';
import { BOARD_PRESETS, DESIGN_COPY as C } from './copy';

export interface BoardInspectorProps {
  session: DeckSession;
  board: BoardView;
  readOnly: boolean;
}

const LABELS: Record<keyof BoardFrame, string> = { x: C.boardX, y: C.boardY, w: C.boardWidth, h: C.boardHeight };
const CAPTIONS: Record<keyof BoardFrame, string> = { x: 'X', y: 'Y', w: 'W', h: 'H' };
const PAIRS: readonly (readonly (keyof BoardFrame)[])[] = [FRAME_KEYS.slice(0, 2), FRAME_KEYS.slice(2)];

export function BoardInspector({ session, board, readOnly }: BoardInspectorProps) {
  const locked = readOnly || board.held !== null || board.missing || board.frame === null;
  // C's fields read the inspector's context for its read-only state alone; the board's section writes through its own
  const api = useMemo<InspectorApi>(() => ({ session, slideId: board.id, picked: [], readOnly: locked, faces: {}, style: () => [], attrs: () => {} }), [session, board.id, locked]);
  const [refused, setRefused] = useState<string | null>(null);

  const write = (frame: Partial<BoardFrame>, typing: string | null): string[] => {
    try {
      const run = (origin: object) => setBoardFrame(session.doc, board.id, frame, origin);
      if (typing === null) session.edit(run);
      else session.typing(`board:${board.id}:${typing}`, run);
      setRefused(null);
      return [];
    } catch (error) {
      if (error instanceof BoardError) return error.problems;
      throw error;
    }
  };
  const preset = board.frame ? (BOARD_PRESETS.find((p) => p.w === board.frame!.w && p.h === board.frame!.h)?.id ?? 'custom') : 'custom';

  return (
    <InspectorContext.Provider value={api}>
      <div key={board.id} className="deck-inspector-body design-board-inspector" data-board-inspector={board.id}>
        <h2 className="deck-inspector-title">{boardLabel(board)}</h2>
        <Section title={C.board}>
          <Row caption={C.boardName} wide>
            <NameField key={board.title} title={board.title} disabled={locked} onCommit={(title) => session.edit(() => writeBoardEntry(session.doc, board.id, { title: title || undefined }))} /* inside the edit's transaction, under its origin */ />
          </Row>
          {PAIRS.map((pair) => (
            <div key={pair.join('')} className="deck-inspector-pair">
              {pair.map((k) => (
                <NumberField key={k} label={LABELS[k]} caption={CAPTIONS[k]} value={board.frame?.[k] ?? null} unit="px" onCommit={(n, how) => (n === null ? [] : write({ [k]: n }, how === 'edit' ? null : k))} />
              ))}
            </div>
          ))}
          <Row caption={C.boardSize} wide>
            <select
              className="deck-inspector-select"
              aria-label={C.boardSize}
              value={preset}
              disabled={locked}
              onChange={(event) => {
                const p = BOARD_PRESETS.find((x) => x.id === event.target.value);
                if (!p) return;
                const reasons = write({ w: p.w, h: p.h }, null);
                setRefused(reasons.length ? reasons.join('; ') : null);
              }}
            >
              <option value="custom" disabled>
                {C.custom}
              </option>
              {BOARD_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {C.preset(p.label, p.w, p.h)}
                </option>
              ))}
            </select>
          </Row>
          <Refusal reason={refused} />
        </Section>
      </div>
    </InspectorContext.Provider>
  );
}

/** The board's name, written on Enter or on leaving the field (empty: no title; the id names it). */
function NameField({ title, disabled, onCommit }: { title: string; disabled: boolean; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(title);
  const commit = () => {
    const next = draft.trim();
    if (next !== title) onCommit(next);
  };
  return (
    <span className="deck-inspector-input-wrap">
      <input
        type="text"
        className="deck-inspector-input"
        aria-label={C.boardName}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          else if (event.key === 'Escape') setDraft(title);
        }}
      />
    </span>
  );
}

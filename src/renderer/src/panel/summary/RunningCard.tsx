// The frame of the two cards for running work (UX wave U8b, M8; its execution document, Interfaces §D): a heading that
// opens the card's panel, its count where a folding card shows its summary; the rows; then `N more`, which opens the
// panel, and `N finished` as the last line, which opens it with Done unfolded. It does not fold: it is drawn only while
// something runs.
import type { ReactNode } from 'react';
import { dateFormats } from '@shared/app/date-format';
import { elapsedOf } from '../../tools/agents/model/elapsed';
import type { TaskNode } from '../../tools/agents/model/task-graph';
import { SLOW_TICK_MS, useTicker } from '../../tools/agents/subagents/shared';
import { SUMMARY_COPY } from '../copy';

export interface RunningCardProps {
  title: string;
  running: number;
  more: number; // the rows past the card's four
  finished: number; // the panel's Done count
  onOpen(): void;
  onFinished(): void;
  children: ReactNode;
}

const TAIL = 'flex h-7 w-full min-w-0 items-center px-3 text-left text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2';

export function RunningCard({ title, running, more, finished, onOpen, onFinished, children }: RunningCardProps) {
  return (
    <section aria-label={title} className="shrink-0 overflow-hidden rounded-md border border-border bg-bg-raised text-ui text-fg shadow-strip">
      <h3>
        <button type="button" onClick={onOpen} className="flex h-10 w-full min-w-0 items-center gap-1.5 rounded-md px-3 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2">
          <span className="shrink-0 font-medium">{title}</span>{' '}
          <span className="ml-auto min-w-0 truncate text-ui-sm font-normal text-fg-muted tabular-nums">{SUMMARY_COPY.running(running)}</span>
        </button>
      </h3>
      <div className="flex min-w-0 flex-col pb-1">
        {children}
        {more > 0 && (
          <button type="button" onClick={onOpen} className={TAIL}>
            {SUMMARY_COPY.more(more)}
          </button>
        )}
        {finished > 0 && (
          <button type="button" onClick={onFinished} className={TAIL}>
            {SUMMARY_COPY.finished(finished)}
          </button>
        )}
      </div>
    </section>
  );
}

// The rows a card draws before its `N more`.
export const CARD_ROWS = 4;

// A row's elapsed time on a card: the display module's compact age (`now`, `2m`, `1h`) of a running node, repainted on
// the slow tick and never each second (M8 decision 2: an unattended window's cost, item 566). Nothing when the node is
// not running or its elapsed time is unknown: the card has no room for the panel's `elapsed unavailable`.
export const coarseElapsed = (node: TaskNode, now: number): string => {
  const elapsed = node.status === 'running' ? elapsedOf(node, now) : null;
  return elapsed === null ? '' : dateFormats().age(elapsed.ms);
};

// The clock a card's rows read: the slow tick while one of them shows a running time.
export const useCardClock = (nodes: readonly TaskNode[]): number => useTicker(nodes.some((node) => node.status === 'running' && elapsedOf(node, 0)?.live === true), SLOW_TICK_MS);

// One group of the Overview board: its heading (the Needs-you group carries its count) over a grid of cards.
import type { KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { CardGroup as Group } from './derive';
import { SessionCard } from './SessionCard';

export interface CardGroupProps {
  group: Group;
  count: number | null;
  paneIndex: 0 | 1;
  stop: AppSessionId | null;
  onCardFocus(appSessionId: AppSessionId): void;
  onCardKeyDown(appSessionId: AppSessionId): (event: KeyboardEvent<HTMLElement>) => void;
}

export function CardGroup({ group, count, paneIndex, stop, onCardFocus, onCardKeyDown }: CardGroupProps) {
  return (
    <section role="listitem" aria-label={group.title} className="flex flex-col gap-2.5">
      <h2 className="m-0 text-ui-sm font-semibold tracking-wide text-fg-muted">
        {count === null ? group.title : `${group.title} · ${count}`}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {group.sessions.map((appSessionId) => (
          <SessionCard
            key={appSessionId}
            appSessionId={appSessionId}
            paneIndex={paneIndex}
            showProject={group.id === 'needs-you'}
            stop={stop === appSessionId}
            onFocus={() => onCardFocus(appSessionId)}
            onKeyDown={onCardKeyDown(appSessionId)}
          />
        ))}
      </div>
    </section>
  );
}

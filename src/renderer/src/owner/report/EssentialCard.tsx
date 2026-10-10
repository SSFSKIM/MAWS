// What the person must not miss (an `essential` mark; the P2-C document, Design §8): a prominent card, an accent rule
// and "Must read", with Mark read, until it is read; then it keeps its content, drops the emphasis and says "Read". An
// essential written before the session's watermark draws read, with no action, since there is nothing to clear. Mark
// read is the caller's (`ownerChannel.markRead`, OwnerReport's): without its handler the button draws disabled; one
// that failed is said on the card, whose Mark read stays to try again.
import { useState } from 'react';
import type { OwnerMark } from '@shared/owner/state';
import { Markdown } from '../../transcript/view/markdown/Markdown';
import { ESSENTIAL, LABEL } from './copy';

export interface EssentialCardProps {
  text: string;
  live: boolean;
  mark: Pick<OwnerMark, 'item' | 'essential'> | null; // null: main has no row for it yet (streaming, or not derived yet)
  markRead?: () => Promise<string | null>; // null: read; else the failure's words
}

export function EssentialCard({ text, live, mark, markRead }: EssentialCardProps) {
  const state = mark?.essential?.state ?? 'unread';
  const before = mark !== null && !mark.item; // before the watermark: nothing to clear
  const unread = state === 'unread' && !before;
  const [failed, setFailed] = useState<string | null>(null);
  const read = async () => {
    if (!markRead) return;
    setFailed(null);
    setFailed(await markRead());
  };
  return (
    <section className="owner-card" data-owner-card="essential" data-state={unread ? 'unread' : 'read'} aria-label={LABEL.essential}>
      <div className="owner-card-label">{LABEL.essential}</div>
      <div className="owner-card-body">
        <Markdown markdown={text} live={live} />
        {unread && failed !== null && (
          <p role="alert" className="owner-card-state" data-failed="">
            {ESSENTIAL.notMarked(failed)}
          </p>
        )}
        {unread ? (
          <div className="owner-card-actions">
            <button type="button" className="owner-card-button" disabled={!markRead} onClick={() => void read()}>
              {ESSENTIAL.markRead}
            </button>
          </div>
        ) : (
          state === 'read' && !before && <p className="owner-card-state">{ESSENTIAL.read}</p>
        )}
      </div>
    </section>
  );
}

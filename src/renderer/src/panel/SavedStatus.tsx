// An editor's saved state in its header (X32's `saved`), the same in the header row and in an editor-owned toolbar
// (the word cut: T607, P23, P24). One wording across the editors: "All changes saved" after a save, never a shorter
// "Saved". A save in flight is the quiet spinner named "Saving…"; edits not yet saved are the editor's conventional
// dot, its words its name and its tip, taking the keyboard so the tip is reachable. Reconnecting and read-only keep
// their words: each says something could have failed or cannot be done here.
import { QuietSpinner } from '../ui/spinner';
import { Tip } from '../ui/tip';
import { SAVED_COPY, type SavedState } from './editor-host';

const WORDS = 'truncate text-ui-sm text-fg-muted';

export function SavedStatus({ state, className = '' }: { state: SavedState; className?: string }) {
  const words = SAVED_COPY[state];
  if (state === 'saving' || state === 'unsaved') {
    return (
      <span data-header-saved data-saved-state={state} className="flex size-4 shrink-0 items-center justify-center">
        {state === 'saving' ? (
          <QuietSpinner label={words} />
        ) : (
          <Tip content={words}>
            <span role="img" aria-label={words} tabIndex={0} className="size-2 rounded-full bg-fg-muted outline-accent focus-visible:outline-2" />
          </Tip>
        )}
      </span>
    );
  }
  return (
    <span data-header-saved data-saved-state={state} title={words} className={`${WORDS} ${className}`}>
      {words}
    </span>
  );
}

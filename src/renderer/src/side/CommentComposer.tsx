// The comment composer (X10's one composer; E3 execution document, Design §6, §8 and §9, M3's decisions): the sheet
// every producer without a host opens through E5's seam (`openCommentComposer`), naming what the comment is about, taking
// the comment in a plain textarea (Enter sends, Shift+Enter breaks a line; no mentions or attachments: a comment is
// short, and the composer's typed slash seam must not run here), and sending it to a side thread (the default, P-6) or
// to the main conversation. A producer's screenshot shows as a thumbnail the person can remove (E11 F2b, Q4); the sheet
// has no screenshot of its own. While a side thread starts the form is disabled and Send reads Starting…; a refusal stays
// under the form with Retry (disabled once its destination cannot send) and, while the parent runs, Send to main
// instead; a refusal arriving after the sheet closed is a toast. Its own small store, as E5's editor sheets have, so it
// never collides with C10's one-sheet dialog store or E1's sheets. Since P2-E1 the form's logic and parts are shared
// with the comment card (`comment-form.ts`, `CommentFormParts.tsx`), which a producer with a host asks for instead.
import { create } from 'zustand';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { FIELD, PRIMARY } from '../sessions/ui';
import type { CommentContext } from '../tools/code/anchor/anchor';
import { useCommentForm } from './comment-form';
import { CommentRefusal, DestinationControl, ScreenshotThumbnail } from './CommentFormParts';
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.composer;

interface OpenComposer {
  anchor: Anchor;
  appSessionId: AppSessionId;
  serial: number; // a new anchor is a new form
}

export const useCommentComposer = create<{ open: OpenComposer | null }>()(() => ({ open: null }));

let serial = 0;

// The sheet's opener (the seam's, for every placement but a card: `register.ts`): one sheet at a time, the latest
// anchor winning.
export function openComposer(anchor: Anchor, context: CommentContext): void {
  useCommentComposer.setState({ open: { anchor, appSessionId: context.appSessionId, serial: ++serial } });
}

const close = () => useCommentComposer.setState({ open: null });

// Mounted once (App.tsx's E3 block); the sheet, while one is open.
export function CommentComposerHost() {
  const open = useCommentComposer((s) => s.open);
  if (open === null) return null;
  return <CommentSheet key={open.serial} anchor={open.anchor} parent={open.appSessionId} />;
}

function CommentSheet({ anchor, parent }: { anchor: Anchor; parent: AppSessionId }) {
  // closed, or replaced by another comment, while a send was on its way
  const form = useCommentForm({ anchor, parent, gone: () => useCommentComposer.getState().open?.anchor !== anchor, onSent: close });
  return (
    <Sheet title={COPY.title(anchor.kind === 'none' ? null : anchor.label)} width="w-[min(560px,90vw)]" onClose={close} data-comment-composer="" data-anchor-kind={anchor.kind} data-anchor-locator={anchor.locator}>
      <SheetForm canSubmit={form.canSend(form.destination)} onSubmit={() => void form.send(form.destination)} submitLabel={form.submitLabel} submitClass={PRIMARY}>
        {anchor.kind !== 'none' && (
          <p className="-mt-2 mb-0 font-mono text-ui-sm break-all text-fg-muted" title={anchor.locator}>
            {anchor.locator}
          </p>
        )}
        {form.screenshot !== null && <ScreenshotThumbnail parent={parent} screenshot={form.screenshot} disabled={form.sending} onRemove={form.removeScreenshot} />}
        <textarea
          aria-label={COPY.field}
          placeholder={COPY.placeholder}
          autoFocus
          rows={4}
          value={form.text}
          disabled={form.sending}
          onChange={(event) => form.setText(event.target.value)}
          onKeyDown={form.onKeyDown}
          className={`${FIELD} min-h-[88px] resize-y leading-snug disabled:text-fg-muted`}
        />
        <DestinationControl form={form} />
        <CommentRefusal form={form} />
      </SheetForm>
    </Sheet>
  );
}

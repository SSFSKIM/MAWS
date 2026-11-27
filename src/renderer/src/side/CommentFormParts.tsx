// The comment form's parts, drawn alike by the sheet and the card (P2-E1 document, D5): the producer's screenshot as a
// thumbnail, the checkbox for where the comment goes, the lines that say why a send can't go as it stands, and the
// refusal. UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M2): one checkbox, "Send to main"
// (`input[data-send-to-main]`), in place of the two radios; its caption is its tip in both presentations (decision 19).
import { useEffect, useRef, useState } from 'react';
import type { AnchorScreenshot } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { CHOICE, QUIET, SECONDARY } from '../sessions/ui';
import { Tip, unavailableClickProps } from '../ui/tip';
import type { CommentForm } from './comment-form';
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.composer;

// E11 F2b (Q4, owner-decided: "a small image preview"): the producer's screenshot as a thumbnail of itself, so the area can
// be checked before sending, named as the chip was ("Screenshot · W × H"); main reads it through the send's own checks
// (`side.screenshot.preview`). Until it answers, or when it refuses, the word stands in, its size (and why no picture
// was asked for) its tooltip (the word cut, P434). Remove is its own worded button (rule 4: Remove stays a word).
export function ScreenshotThumbnail({ parent, screenshot, disabled, onRemove }: { parent: AppSessionId; screenshot: AnchorScreenshot; disabled: boolean; onRemove(): void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const unavailable = useRemoteUnavailable(parent, 'side.screenshot.preview'); // P5 O7 M8: the size in words stands in, asked nothing
  useEffect(() => {
    if (unavailable !== null) return;
    let live = true;
    void ipc.invoke('side.screenshot.preview', { appSessionId: parent, screenshot }).then((result) => {
      if (live && result.ok) setDataUrl(result.value.dataUrl);
    });
    return () => {
      live = false;
    };
  }, [parent, screenshot, unavailable]);
  const name = COPY.screenshot(screenshot.width, screenshot.height);
  const size = COPY.screenshotSize(screenshot.width, screenshot.height);
  return (
    <div className="flex items-end justify-between gap-2 rounded-sm border border-border bg-bg-raised p-1.5 text-ui-sm text-fg-muted" data-comment-screenshot="">
      {dataUrl === null ? (
        <Tip
          content={
            unavailable === null ? (
              size
            ) : (
              <>
                <span className="block">{size}</span>
                <span className="block text-fg-muted">{unavailable}</span>
              </>
            )
          }
          description={unavailable === null ? size : `${size} · ${unavailable}`}
        >
          <span tabIndex={0} className="rounded-sm px-0.5 outline-accent focus-visible:outline-2">
            {COPY.screenshotWord}
          </span>
        </Tip>
      ) : (
        // board ticket 815: its name and size its tip, which focus shows too
        <Tip content={name}>
          <img src={dataUrl} alt={name} tabIndex={0} className="max-h-24 max-w-[60%] rounded-sm border border-border object-contain outline-accent focus-visible:outline-2" />
        </Tip>
      )}
      <button type="button" className={QUIET} disabled={disabled} onClick={onRemove}>
        {COPY.removeScreenshot}
      </button>
    </div>
  );
}

// UX wave U5a: where the comment goes, as the app's checkbox: ticked, the session's own conversation; unchecked, a side
// thread. Its tip says what a tick does now, or why the box is fixed (board ticket 815: on pointing anywhere in its line,
// and on the box's focus; a fixed box keeps Tab, drawn aria-disabled, its tick swallowed).
export function SendToMainBox({ form }: { form: CommentForm }) {
  const line = useRef<HTMLLabelElement>(null);
  return (
    <label ref={line} className={`flex min-w-0 items-center gap-1.5 text-ui-sm ${form.toMainFixed ? 'text-fg-muted' : 'text-fg'}`}>
      <Tip content={form.toMainTitle} description={form.toMainTitle} pointedWithin={line} {...unavailableClickProps(form.toMainFixed ? form.toMainTitle : null)}>
        <input type="checkbox" data-send-to-main="" checked={form.toMain} onChange={(event) => !form.toMainFixed && form.setToMain(event.target.checked)} className={CHOICE} />
      </Tip>
      <span className="truncate">{COPY.main}</span>
    </label>
  );
}

// UX wave U5a: under the row with the checkbox and Send, why the send can't go as it stands (neither state can send, or
// the one it is in can't), and the screenshots the route will leave out (decision 9).
export function CommentFormLines({ form }: { form: CommentForm }) {
  return (
    <>
      {form.unsendable !== null && (
        <p data-comment-unsendable="" className="m-0 text-ui-sm text-fg-muted">
          {form.unsendable}
        </p>
      )}
      {form.leftOut !== null && (
        <p data-left-out="" className="m-0 text-ui-sm text-fg-muted">
          {COPY.leftOut(form.leftOut.count, form.leftOut.reason)}
        </p>
      )}
    </>
  );
}

// A refused send, under the form: its reason, Retry (disabled once its destination cannot send) and, for a side thread
// while a tick can send, Send to main instead. `onSend`: the presentation's own send (the card's), else the form's.
export function CommentRefusal({ form, onSend }: { form: CommentForm; onSend?(to: 'thread' | 'main'): void }) {
  const { phase } = form;
  if (phase.kind !== 'refused') return null;
  const send = onSend ?? ((to: 'thread' | 'main') => void form.send(to));
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm border border-danger px-2.5 py-1.5 text-ui-sm text-danger">
      <span className="min-w-0 flex-1 break-words">{phase.error}</span>
      <button type="button" className={SECONDARY} disabled={!form.canSend(phase.destination)} onClick={() => send(phase.destination)}>
        {COPY.retry}
      </button>
      {phase.destination === 'thread' && form.mainEnabled && ( /* P2-A: mainEnabled */
        <button type="button" className={SECONDARY} onClick={() => send('main')}>
          {COPY.mainInstead}
        </button>
      )}
    </div>
  );
}

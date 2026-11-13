// The comment form's parts, drawn alike by the sheet and the card (P2-E1 document, D5): the producer's screenshot as a
// thumbnail, the checkbox for where the comment goes, the lines that say why a send can't go as it stands, and the
// refusal. UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M2): one checkbox, "Send to main"
// (`input[data-send-to-main]`), in place of the two radios; its caption is its title in both presentations (decision 19).
import { useEffect, useState } from 'react';
import type { AnchorScreenshot } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { CHOICE, QUIET, SECONDARY } from '../sessions/ui';
import type { CommentForm } from './comment-form';
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.composer;

// E11 F2b (Q4, owner-decided: "a small image preview"): the producer's screenshot as a thumbnail of itself, so the area can
// be checked before sending, named as the chip was ("Screenshot · W × H"); main reads it through the send's own checks
// (`side.screenshot.preview`). Until it answers, or when it refuses, the size in words stands in. Remove is its own button.
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
  return (
    <div className="flex items-end justify-between gap-2 rounded-sm border border-border bg-bg-raised p-1.5 text-ui-sm text-fg-muted" data-comment-screenshot="">
      {dataUrl === null ? (
        <span className="px-0.5" title={unavailable ?? undefined}>
          {name}
        </span>
      ) : (
        <img src={dataUrl} alt={name} title={name} className="max-h-24 max-w-[60%] rounded-sm border border-border object-contain" />
      )}
      <button type="button" className={QUIET} disabled={disabled} onClick={onRemove}>
        {COPY.removeScreenshot}
      </button>
    </div>
  );
}

// UX wave U5a: where the comment goes, as the app's checkbox: ticked, the session's own conversation; unchecked, a side
// thread. Its title says what a tick does now, or why the box is fixed.
export function SendToMainBox({ form }: { form: CommentForm }) {
  return (
    <label title={form.toMainTitle} className={`flex min-w-0 items-center gap-1.5 text-ui-sm ${form.toMainFixed ? 'text-fg-muted' : 'text-fg'}`}>
      <input type="checkbox" data-send-to-main="" checked={form.toMain} disabled={form.toMainFixed} onChange={(event) => form.setToMain(event.target.checked)} className={CHOICE} />
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

// The comment form's parts, drawn alike by the sheet and the card (P2-E1 document, D5): the producer's screenshot as a
// thumbnail, the destination control and the refusal. The card draws the destination compact, its captions moved into
// each segment's title; its accessible structure (two radios named "Side thread" and "Send to main", each label carrying
// `data-destination`) is the sheet's either way, so every locator written for the sheet's form finds the card's.
import { useEffect, useId, useState } from 'react';
import type { AnchorScreenshot } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { QUIET, SECONDARY } from '../sessions/ui';
import type { CommentDestination } from './actions';
import type { CommentForm } from './comment-form';
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.composer;

// E11 F2b (Q4, owner-decided: "a small image preview"): the producer's screenshot as a thumbnail of itself, so the area can
// be checked before sending, named as the chip was ("Screenshot · W × H"); main reads it through the send's own checks
// (`side.screenshot.preview`). Until it answers, or when it refuses, the size in words stands in. Remove is its own button.
export function ScreenshotThumbnail({ parent, screenshot, disabled, onRemove }: { parent: AppSessionId; screenshot: AnchorScreenshot; disabled: boolean; onRemove(): void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void ipc.invoke('side.screenshot.preview', { appSessionId: parent, screenshot }).then((result) => {
      if (live && result.ok) setDataUrl(result.value.dataUrl);
    });
    return () => {
      live = false;
    };
  }, [parent, screenshot]);
  const name = COPY.screenshot(screenshot.width, screenshot.height);
  return (
    <div className="flex items-end justify-between gap-2 rounded-sm border border-border bg-bg-raised p-1.5 text-ui-sm text-fg-muted" data-comment-screenshot="">
      {dataUrl === null ? (
        <span className="px-0.5">{name}</span>
      ) : (
        <img src={dataUrl} alt={name} title={name} className="max-h-24 max-w-[60%] rounded-sm border border-border object-contain" />
      )}
      <button type="button" className={QUIET} disabled={disabled} onClick={onRemove}>
        {COPY.removeScreenshot}
      </button>
    </div>
  );
}

// Two radios drawn as a segmented control: where the comment goes. The sheet shows each one-line caption under its
// label; the compact control (the card's) keeps the caption as the segment's title.
export function DestinationControl({ form, compact = false }: { form: CommentForm; compact?: boolean }) {
  const name = useId();
  const options: { to: CommentDestination; label: string; caption: string; enabled: boolean }[] = [
    { to: 'thread', label: COPY.thread, caption: COPY.threadCaption, enabled: true },
    { to: 'main', label: COPY.main, caption: form.mainCaption, enabled: form.ready },
  ];
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={form.sending}>
      <legend className={compact ? 'sr-only' : 'mb-1.5 p-0 text-ui-sm text-fg-muted'}>{COPY.destination}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-bg p-0.5">
        {options.map((option) => (
          <label
            key={option.to}
            data-destination={option.to}
            title={compact ? option.caption : undefined}
            className={`flex min-w-0 cursor-default flex-col gap-0.5 rounded-sm border outline-accent has-[:focus-visible]:outline-2 ${compact ? 'px-2 py-0.5' : 'px-2.5 py-1.5'} ${
              form.destination === option.to ? 'border-border-strong bg-bg-active' : 'border-transparent hover:bg-bg-hover'
            } ${option.enabled ? '' : 'opacity-60'}`}
          >
            <input type="radio" name={name} value={option.to} checked={form.destination === option.to} disabled={!option.enabled} onChange={() => form.setDestination(option.to)} className="sr-only" />
            <span className={`truncate text-fg ${compact ? 'text-ui-sm' : 'text-ui'}`}>{option.label}</span>
            {!compact && <span className="text-ui-sm text-fg-muted">{option.caption}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// A refused send, under the form: its reason, Retry (disabled once its destination cannot send) and, for a side thread
// while the parent runs, Send to main instead.
export function CommentRefusal({ form }: { form: CommentForm }) {
  const { phase } = form;
  if (phase.kind !== 'refused') return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm border border-danger px-2.5 py-1.5 text-ui-sm text-danger">
      <span className="min-w-0 flex-1 break-words">{phase.error}</span>
      <button type="button" className={SECONDARY} disabled={!form.canSend(phase.destination)} onClick={() => void form.send(phase.destination)}>
        {COPY.retry}
      </button>
      {phase.destination === 'thread' && form.ready && (
        <button type="button" className={SECONDARY} onClick={() => void form.send('main')}>
          {COPY.mainInstead}
        </button>
      )}
    </div>
  );
}

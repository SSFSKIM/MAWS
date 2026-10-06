// The comment composer (X10's one composer; E3 execution document, Design §6, §8 and §9, M3's decisions): the sheet
// every producer opens through E5's seam (`openCommentComposer`), naming what the comment is about, taking the comment
// in a plain textarea (Enter sends, Shift+Enter breaks a line; no mentions or attachments: a comment is short, and the
// composer's typed slash seam must not run here), and sending it to a side thread (the default, P-6) or to the main
// conversation. A producer's screenshot shows as a chip the person can remove; the sheet has no screenshot of its own.
// While a side thread starts the form is disabled and Send reads Starting…; a refusal stays under the form with Retry
// and, while the parent runs, Send to main instead. Its own small store, as E5's editor sheets have, so it never
// collides with C10's one-sheet dialog store or E1's sheets.
import { useId, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { FIELD, PRIMARY, QUIET, SECONDARY } from '../sessions/ui';
import { useSessions } from '../stores/sessions';
import { sendComment, type CommentDestination } from './actions';
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.composer;

interface OpenComposer {
  anchor: Anchor;
  appSessionId: AppSessionId;
  serial: number; // a new anchor is a new form
}

export const useCommentComposer = create<{ open: OpenComposer | null }>()(() => ({ open: null }));

let serial = 0;

// E5's seam's opener (registered from App.tsx's E3 block): one sheet at a time, the latest anchor winning.
export function openComposer(anchor: Anchor, context: { appSessionId: AppSessionId }): void {
  useCommentComposer.setState({ open: { anchor, appSessionId: context.appSessionId, serial: ++serial } });
}

const close = () => useCommentComposer.setState({ open: null });

// Mounted once (App.tsx's E3 block); the sheet, while one is open.
export function CommentComposerHost() {
  const open = useCommentComposer((s) => s.open);
  if (open === null) return null;
  return <CommentSheet key={open.serial} anchor={open.anchor} parent={open.appSessionId} />;
}

type Phase = { kind: 'editing' } | { kind: 'sending'; destination: CommentDestination } | { kind: 'refused'; destination: CommentDestination; error: string };

function CommentSheet({ anchor, parent }: { anchor: Anchor; parent: AppSessionId }) {
  const status = useSessions((s) => s.engine.get(parent) ?? null);
  const [text, setText] = useState('');
  const [destination, setDestination] = useState<CommentDestination>('thread');
  const [screenshot, setScreenshot] = useState<AnchorScreenshot | null>(anchor.screenshot ?? null);
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const ready = status?.process === 'ready';
  const sending = phase.kind === 'sending';
  const canSend = (to: CommentDestination) => text.trim() !== '' && !sending && (to === 'thread' || ready);

  const send = async (to: CommentDestination) => {
    if (!canSend(to)) return;
    setDestination(to);
    setPhase({ kind: 'sending', destination: to });
    const result = await sendComment(to, { parent, anchor, text: text.trim(), screenshot });
    if (useCommentComposer.getState().open?.anchor !== anchor) return; // closed, or replaced by another comment, meanwhile
    if (result.ok) close();
    else setPhase({ kind: 'refused', destination: to, error: result.error });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(destination);
  };

  const submitLabel = sending ? (phase.destination === 'thread' ? COPY.starting : COPY.sending) : COPY.send;
  const mainCaption = !ready ? COPY.mainNotRunning : status?.turn ? COPY.mainBusy : COPY.mainIdle;

  return (
    <Sheet title={COPY.title(anchor.kind === 'none' ? null : anchor.label)} width="w-[min(560px,90vw)]" onClose={close} data-comment-composer="" data-anchor-kind={anchor.kind} data-anchor-locator={anchor.locator}>
      <SheetForm canSubmit={canSend(destination)} onSubmit={() => void send(destination)} submitLabel={submitLabel} submitClass={PRIMARY}>
        {anchor.kind !== 'none' && (
          <p className="-mt-2 mb-0 font-mono text-ui-sm break-all text-fg-muted" title={anchor.locator}>
            {anchor.locator}
          </p>
        )}
        {screenshot !== null && (
          <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-bg-raised px-2 py-1 text-ui-sm text-fg-muted" data-comment-screenshot="">
            <span>{COPY.screenshot(screenshot.width, screenshot.height)}</span>
            <button type="button" className={QUIET} disabled={sending} onClick={() => setScreenshot(null)}>
              {COPY.removeScreenshot}
            </button>
          </div>
        )}
        <textarea
          aria-label={COPY.field}
          placeholder={COPY.placeholder}
          autoFocus
          rows={4}
          value={text}
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className={`${FIELD} min-h-[88px] resize-y leading-snug disabled:text-fg-muted`}
        />
        <DestinationControl value={destination} onChange={setDestination} disabled={sending} mainEnabled={ready} mainCaption={mainCaption} />
        {phase.kind === 'refused' && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm border border-danger px-2.5 py-1.5 text-ui-sm text-danger">
            <span className="min-w-0 flex-1 break-words">{phase.error}</span>
            <button type="button" className={SECONDARY} onClick={() => void send(phase.destination)}>
              {COPY.retry}
            </button>
            {phase.destination === 'thread' && ready && (
              <button type="button" className={SECONDARY} onClick={() => void send('main')}>
                {COPY.mainInstead}
              </button>
            )}
          </div>
        )}
      </SheetForm>
    </Sheet>
  );
}

// Two radios drawn as a segmented control, each with its one-line caption: where the comment goes.
function DestinationControl({ value, onChange, disabled, mainEnabled, mainCaption }: { value: CommentDestination; onChange(to: CommentDestination): void; disabled: boolean; mainEnabled: boolean; mainCaption: string }) {
  const name = useId();
  const options: { to: CommentDestination; label: string; caption: string; enabled: boolean }[] = [
    { to: 'thread', label: COPY.thread, caption: COPY.threadCaption, enabled: true },
    { to: 'main', label: COPY.main, caption: mainCaption, enabled: mainEnabled },
  ];
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="mb-1.5 p-0 text-ui-sm text-fg-muted">{COPY.destination}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-bg p-0.5">
        {options.map((option) => (
          <label
            key={option.to}
            data-destination={option.to}
            className={`flex min-w-0 cursor-default flex-col gap-0.5 rounded-sm border px-2.5 py-1.5 outline-accent has-[:focus-visible]:outline-2 ${
              value === option.to ? 'border-border-strong bg-bg-active' : 'border-transparent hover:bg-bg-hover'
            } ${option.enabled ? '' : 'opacity-60'}`}
          >
            <input type="radio" name={name} value={option.to} checked={value === option.to} disabled={!option.enabled} onChange={() => onChange(option.to)} className="sr-only" />
            <span className="text-ui text-fg">{option.label}</span>
            <span className="text-ui-sm text-fg-muted">{option.caption}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

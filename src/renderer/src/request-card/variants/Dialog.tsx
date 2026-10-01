// The dialog body (C7 execution document, Request card; X6, SPEC 45 §45.22.13): the two kinds C3's `initialize`
// declares, each read through its pinned payload schema and answered with its string result, and every other dialog
// (an undeclared kind, or a declared kind whose payload does not validate) shown pending with nothing to answer: MAWS
// never completes or cancels it, and the engine's dialog timeout retires it.
//
// The refusal's Edit prompt captures the prompt the refusal interrupted from the transcript store before it answers,
// and only once the answer is delivered edits that bubble in place (W3, B6; the terminal's own recovery: rewind to the
// last human prompt and restore it), whose Send rewinds to it and resends.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../ipc/client';
import { startInlineEdit } from '../../composer/resubmit-seam';
import type { UserRow } from '../../composer/edit-prefill';
import type { MessageUuid } from '@shared/graph/ids';
import { toast } from '../../stores/notices';
import { ipcSource, useTranscriptStore } from '../../transcript';
import { toAnswer } from '../answers';
import { CardButton, Controls, Muted, pretty } from '../controls';
import { initiatingPrompt } from '../initiating-prompt';
import { declaredDialog, type AutoModeServerFallbackPayload, type RefusalFallbackPayload } from './dialog-kinds';
import type { VariantProps } from './types';

// The session's transcript as the store holds it, attached for the read: `ipcSource` is memoised per key, so a mounted
// view's attachment is shared (counted, already hydrated), and with no holder the key hydrates again from the source.
// A kept `live` entry alone is not current: the store keeps it after its last holder detaches, and stops following.
async function captureInitiatingPrompt(appSessionId: AppSessionId): Promise<(UserRow & { messageUuid: MessageUuid }) | null> {
  const read = () => initiatingPrompt(useTranscriptStore.getState().rows(appSessionId), useTranscriptStore.getState().activity(appSessionId));
  await useTranscriptStore.getState().attach(appSessionId, ipcSource(appSessionId));
  try {
    return read();
  } finally {
    useTranscriptStore.getState().detach(appSessionId);
  }
}

type DialogProps = VariantProps<'dialog.requested'>;

function RefusalFallback({ item, payload, busy: answering, submit, bindKeys }: DialogProps & { payload: RefusalFallbackPayload }) {
  const [capturing, setCapturing] = useState(false); // reading the prompt before the answer goes
  const busy = answering || capturing;
  const answer = (result: 'retry_fallback' | 'edit_prompt' | 'cancelled', what: string, delivered?: () => void) =>
    submit(toAnswer({ kind: 'dialog', dialogKind: 'refusal_fallback_prompt', result }), what, delivered);
  const retry = () => !capturing && answer('retry_fallback', `Retry with ${payload.fallbackModel}`);
  const cancel = () => !capturing && answer('cancelled', 'Cancelled');
  const editPrompt = async () => {
    setCapturing(true);
    const prompt = await captureInitiatingPrompt(item.appSessionId);
    setCapturing(false);
    answer('edit_prompt', 'Edit prompt', () => {
      if (prompt) startInlineEdit(item.appSessionId, prompt, 'edit');
      else toast({ level: 'info', text: 'No prompt to edit', actions: [], dismissible: true });
    });
  };
  useEffect(() => bindKeys({ accept: retry, decline: cancel }));
  return (
    <div className="flex flex-col gap-3">
      {payload.guidanceText && <p className="m-0 text-fg">{payload.guidanceText}</p>}
      <Muted>
        {payload.originalModel} declined{payload.apiRefusalCategory ? ` · ${payload.apiRefusalCategory}` : ''}
      </Muted>
      <Controls>
        <CardButton disabled={busy} onClick={cancel} className="mr-auto">
          Cancel
        </CardButton>
        <CardButton disabled={busy} onClick={() => void editPrompt()}>
          Edit prompt
        </CardButton>
        <CardButton tone="primary" disabled={busy} onClick={retry}>
          Retry with {payload.fallbackModel}
        </CardButton>
      </Controls>
    </div>
  );
}

function AutoModeServerFallback({ payload, busy, submit, bindKeys }: DialogProps & { payload: AutoModeServerFallbackPayload }) {
  const answer = (result: 'continue' | 'interrupt', what: string) => submit(toAnswer({ kind: 'dialog', dialogKind: 'auto_mode_server_fallback', result }), what);
  const proceed = () => answer('continue', 'Continued');
  const stop = () => answer('interrupt', 'Stopped');
  useEffect(() => bindKeys({ accept: proceed, decline: stop }));
  return (
    <div className="flex flex-col gap-3">
      {payload.paragraphs.map((paragraph, i) => (
        <p key={i} className="m-0 text-fg">
          {paragraph}
        </p>
      ))}
      {payload.gatewayHost && <Muted>{payload.gatewayHost}</Muted>}
      <Controls>
        <CardButton onClick={() => void ipc.invoke('layout.openExternal', { url: payload.helpUrl })} className="mr-auto border-transparent text-fg-muted">
          Learn more
        </CardButton>
        <CardButton disabled={busy} onClick={stop}>
          Stop
        </CardButton>
        <CardButton tone="primary" disabled={busy} onClick={proceed}>
          Continue
        </CardButton>
      </Controls>
    </div>
  );
}

// An undeclared kind, or a declared one whose payload failed its schema: visible, never answered.
function Unanswerable({ request, problem, bindKeys }: DialogProps & { problem: string | null }) {
  useEffect(() => bindKeys({ accept: null, decline: null }));
  return (
    <div className="flex flex-col gap-2">
      <pre className="m-0 max-h-[8lh] overflow-auto rounded-sm border border-border bg-bg px-2.5 py-2 font-mono text-ui-sm whitespace-pre-wrap">{pretty(request.payload)}</pre>
      {problem !== null && <p className="m-0 text-ui-sm text-warning">The payload does not match the declared schema: {problem}</p>}
      <Muted>MAWS did not declare this dialog kind and cannot answer it · it expires by the engine's dialog timeout</Muted>
    </div>
  );
}

export function DialogBody(props: DialogProps) {
  const read = declaredDialog(props.request.dialogKind, props.request.payload);
  if (!read.ok) return <Unanswerable {...props} problem={read.reason === 'invalid' ? read.problem : null} />;
  if (read.dialog.kind === 'refusal_fallback_prompt') return <RefusalFallback {...props} payload={read.dialog.payload} />;
  return <AutoModeServerFallback {...props} payload={read.dialog.payload} />;
}

// The Discard sheet (E6 execution document, Design §8): every path the discard will touch, in a scrollable monospace
// list (no "and N more"), the sentence of what happens per group, and the acknowledgement that alone enables the
// destructive submit (C10's house rule: Enter never destroys anything). Rendered inside the tool through C10's `Sheet`
// with its own close (the tool's `sheet` state), never through C10's dialog store. A refusal or a failed call shows in
// the sheet and leaves it open; success closes it, and the lists move when the watcher's `git.changed` arrives.
import { useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, DANGER } from '../../sessions/ui';
import { SCM_COPY } from './copy';
import { noticeText, PrintedOutput } from './Notice';
import { useScm } from './store';
import type { ScmNotice, ScmSheet, ScmUi } from './view-state';

export type DiscardEntries = Extract<ScmSheet, { kind: 'discard' }>['entries'];

export function DiscardSheet({ appSessionId, ui, entries }: { appSessionId: AppSessionId; ui: StoreApi<ScmUi>; entries: DiscardEntries }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ScmNotice | null>(null);
  const restores = entries.filter((entry) => entry.group === 'unstaged').length;
  const deletes = entries.length - restores;
  const deletion = restores === 0;
  const close = () => ui.setState({ sheet: null });

  const submit = async () => {
    setRunning(true);
    setError(null);
    const result = await useScm.getState().discard(ui, appSessionId, entries);
    setRunning(false);
    if (ui.getState().session !== appSessionId) return; // a pinned tool moved on: its sheet is already gone
    if (!result.ok) setError({ kind: 'error', text: result.error.message, output: '' });
    else if ('refused' in result.value) setError({ kind: result.value.refused, text: result.value.detail, output: result.value.output });
    else close();
  };

  const ack = deletion ? SCM_COPY.deleteAck(entries.length) : SCM_COPY.discardAck(entries.length);
  return (
    <Sheet title={deletion ? SCM_COPY.deleteTitle : SCM_COPY.discardTitle} width="w-[min(520px,92vw)]" onClose={close} data-scm-sheet="discard">
      <SheetForm canSubmit={acknowledged && !running} onSubmit={() => void submit()} submitLabel={deletion ? SCM_COPY.deleteSubmit : SCM_COPY.discardSubmit} submitClass={DANGER}>
        <ul aria-label={deletion ? SCM_COPY.deleteTitle : SCM_COPY.discardTitle} className="m-0 max-h-48 list-none overflow-y-auto rounded-sm border border-border bg-bg-raised px-2 py-1">
          {entries.map((entry) => (
            <li key={`${entry.group}\0${entry.path}`} data-scm-sheet-path className="font-mono text-ui-sm break-all text-fg">
              {entry.path}
            </li>
          ))}
        </ul>
        {restores > 0 ? <p className="m-0 text-ui-sm text-fg-muted">{SCM_COPY.restores(restores)}</p> : null}
        {deletes > 0 ? <p className="m-0 text-ui-sm text-fg-muted">{SCM_COPY.deletes(deletes)}</p> : null}
        <label className="flex items-center gap-2 text-ui-sm text-fg">
          <input type="checkbox" aria-label={ack} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className={CHOICE} />
          {ack}
        </label>
        {error !== null ? (
          <div role="alert" className="flex flex-col gap-1">
            <p className="m-0 text-ui-sm break-words text-danger">{noticeText(error)}</p>
            {error.output !== '' ? <PrintedOutput text={error.output} /> : null}
          </div>
        ) : null}
      </SheetForm>
    </Sheet>
  );
}

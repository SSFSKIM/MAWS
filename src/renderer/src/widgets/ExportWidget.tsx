// `/export` (C11 execution document, the widget table): `export_conversation`'s plain text under the engine's default
// filename, copied through the clipboard or saved through `layout.saveTextFile` (main's save dialog, a temp file then
// a rename). The text is written as the engine produced it; the JSONL stays where it is. The word cut (P638, P640): the
// preview line has no line count, and Copy shows a check for a moment in place of its word, "Copied" said to a screen
// reader alone.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ExportConversationResponse } from '@shared/wire/control';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { EXPORT, WIDGET_TITLE } from './copy';
import { Mono, TextButton } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

export interface ExportView {
  filename: string;
  firstLine: string; // the text's first non-empty line, as a preview
  text: string;
}

export function present(answer: ExportConversationResponse): ExportView {
  const lines = answer.text.split('\n');
  return { filename: answer.default_filename, firstLine: lines.find((l) => l.trim() !== '') ?? '', text: answer.text };
}

const CHECK_MS = 1500; // how long Copy shows its check

export function ExportBody({ view }: { view: ExportView }) {
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(0); // the copy whose check is shown; 0: none
  useEffect(() => {
    if (copied === 0) return;
    const timer = setTimeout(() => setCopied(0), CHECK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.text);
    } catch (error) {
      return void toast({ level: 'warning', text: EXPORT.notCopied(error instanceof Error ? error.message : String(error)), actions: [], dismissible: true });
    }
    setDone(null);
    setCopied((n) => n + 1);
  };
  const save = async () => {
    const result = await ipc.invoke('layout.saveTextFile', { defaultName: view.filename, text: view.text });
    if (!result.ok) return void toast({ level: 'warning', text: EXPORT.notSaved(result.error.message), actions: [], dismissible: true });
    if (result.value.saved) {
      setCopied(0);
      setDone(EXPORT.saved(result.value.path));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0">
        <Mono>{view.filename}</Mono>
      </p>
      <p className="m-0 truncate text-ui-sm text-fg-muted" title={view.firstLine}>
        {view.firstLine}
      </p>
      <div className="flex items-baseline gap-2">
        <TextButton onClick={() => void copy()} aria-label={EXPORT.copy}>
          {copied === 0 ? EXPORT.copy : <span aria-hidden>✓</span>}
        </TextButton>
        {copied !== 0 && (
          <span role="status" className="sr-only">
            {EXPORT.copied}
          </span>
        )}
        <TextButton onClick={() => void save()}>{EXPORT.saveAs}</TextButton>
        {done && (
          <span role="status" className="min-w-0 truncate text-ui-sm text-fg-muted">
            {done}
          </span>
        )}
      </div>
    </div>
  );
}

export function ExportWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.exportConversation', { appSessionId });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.export} command="export" state={read.state} error={read.error} readAt={read.readAt} close={close}>
      {read.data && <ExportBody view={present(read.data)} />}
    </WidgetFrame>
  );
}

// `/export` (C11 execution document, the widget table): `export_conversation`'s plain text under the engine's default
// filename, copied through the clipboard or saved through `layout.saveTextFile` (main's save dialog, a temp file then
// a rename). The text is written as the engine produced it; the JSONL stays where it is.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ExportConversationResponse } from '@shared/wire/control';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { EXPORT, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Mono, num, TextButton } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

export interface ExportView {
  filename: string;
  firstLine: string; // the text's first non-empty line, as a preview
  lines: number;
  text: string;
}

export function present(answer: ExportConversationResponse): ExportView {
  const lines = answer.text.split('\n');
  return { filename: answer.default_filename, firstLine: lines.find((l) => l.trim() !== '') ?? '', lines: lines.length, text: answer.text };
}

export function ExportBody({ view }: { view: ExportView }) {
  const [done, setDone] = useState<string | null>(null);
  const copy = async () => {
    await navigator.clipboard.writeText(view.text);
    setDone(EXPORT.copied);
  };
  const save = async () => {
    const result = await ipc.invoke('layout.saveTextFile', { defaultName: view.filename, text: view.text });
    if (!result.ok) return void toast({ level: 'warning', text: EXPORT.notSaved(result.error.message), actions: [], dismissible: true });
    if (result.value.saved) setDone(EXPORT.saved(result.value.path));
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0">
        <Mono>{view.filename}</Mono>
      </p>
      <p className="m-0 truncate text-ui-sm text-fg-muted" title={view.firstLine}>
        {view.firstLine} <span className="text-fg-faint">· {EXPORT.lines(num(view.lines))}</span>
      </p>
      <div className="flex items-baseline gap-2">
        <TextButton onClick={() => void copy()}>{EXPORT.copy}</TextButton>
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
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.export} command="export" foot={WIDGET_FOOT.export} state={read.state} error={read.error} close={close}>
      {read.data && <ExportBody view={present(read.data)} />}
    </WidgetFrame>
  );
}

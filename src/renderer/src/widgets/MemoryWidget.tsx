// `/memory` (C11 execution document, the widget table): `get_memory_dialog`'s files with whether each exists yet, the
// memory folders and the auto-memory state. Reveal shows a file or folder in Finder through `settings.reveal`, which
// main admits under the config home and the session's directories (ruled 2026-09-29). "Add a note" prefills the
// composer in `#` mode, whose append is C3's `session.memoryAppend` (C7's `#`).
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetMemoryDialogResponse } from '@shared/wire/control';
import { prefillComposer } from '../composer';
import { MEMORY, SHARED, WIDGET_TITLE } from './copy';
import { Group, Mono, RevealButton, Row, Rows, TextButton } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const StatusSchema = z.looseObject({ status: z.string() });

export interface MemoryView {
  files: { label: string; path: string; description: string; exists: boolean; note: string | null }[];
  folders: { label: string; path: string }[];
  autoMemory: string | null; // the engine's own word for the auto-memory state
}

export function present(dialog: GetMemoryDialogResponse): MemoryView {
  const auto = StatusSchema.safeParse(dialog.auto_memory);
  return {
    files: dialog.files.map((f) => ({ label: f.label, path: f.path, description: f.description, exists: f.exists, note: f.exists ? null : MEMORY.missing })),
    folders: dialog.folders.map((f) => ({ label: f.label, path: f.path })),
    autoMemory: auto.success ? auto.data.status : null,
  };
}

export function MemoryBody({ view, appSessionId, close }: { view: MemoryView; appSessionId: AppSessionId; close(): void }) {
  const addNote = () => {
    close();
    prefillComposer(appSessionId, { text: '# ' });
  };
  return (
    <div className="flex flex-col">
      <Group label={MEMORY.files}>
        <Rows label={MEMORY.fileList}>
          {view.files.map((f) => (
            <Row
              key={f.path}
              main={f.label}
              note={f.note}
              detail={
                <>
                  <Mono>{f.path}</Mono>
                  {f.description && <span> · {f.description}</span>}
                </>
              }
              actions={f.exists ? <RevealButton path={f.path}>{SHARED.reveal}</RevealButton> : null}
            />
          ))}
        </Rows>
      </Group>
      {view.folders.length > 0 && (
        <Group label={MEMORY.folders}>
          <Rows label={MEMORY.folderList}>
            {view.folders.map((f) => (
              <Row key={f.path} main={f.label} detail={<Mono>{f.path}</Mono>} actions={<RevealButton path={f.path}>{SHARED.reveal}</RevealButton>} />
            ))}
          </Rows>
        </Group>
      )}
      {view.autoMemory && <p className="m-0 mt-2 text-ui-sm text-fg-muted">{MEMORY.autoMemory(view.autoMemory)}</p>}
      <div className="mt-2">
        <TextButton onClick={addNote}>{MEMORY.addNote}</TextButton>
      </div>
    </div>
  );
}

export function MemoryWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getMemoryDialog', { appSessionId });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.memory} command="memory" state={read.state} error={read.error} readAt={read.readAt} close={close}>
      {read.data && <MemoryBody view={present(read.data)} appSessionId={appSessionId} close={close} />}
    </WidgetFrame>
  );
}

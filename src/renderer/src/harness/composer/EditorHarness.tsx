// The editor harness page (`#editor`; C7 execution document, M3 and Acceptance item 2's editor cases): one session's
// editor over the app's real stores, C5's real key dispatcher and the engine behind them (C3's replay under
// MAWS_ENGINE_REPLAY=1), with the session's transcript attached so recall reads its rows. Submissions go through the
// editor's own dispatch (`session.send`, `session.bash`, …) and are recorded for the test beside what the host wrote.
// Playwright drives it through `window.__maws_editor`, since main blocks navigation within a launch. The frame, the
// submit control and the strip are M4's; this page shows the "+" menu and the attachments' names beside the editor.
import { useEffect, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../ipc/client';
import { connectKeys } from '../../keymap/dispatcher';
import { attachmentsOf, type ComposerDoc } from '../../composer/editor/doc';
import { Editor, type EditorHandle } from '../../composer/editor/Editor';
import { submitSerialized } from '../../composer/editor/submit';
import { registerSlashWidget, type WidgetCommandName } from '../../composer/mentions/widgets';
import { PlusMenu } from '../../composer/plus-menu/PlusMenu';
import { memoryTargetOf, useComposerStore } from '../../stores/composer';
import { ipcSource, useTranscriptStore } from '../../transcript';
import type { EditorHarnessApi, EditorPane, EditorSubmission } from './editor-api';

declare global {
  interface Window {
    __maws_editor?: EditorHarnessApi;
  }
}

function StubWidget({ args, close }: { args: string; close(): void }) {
  return (
    <div className="flex items-center gap-2">
      <span>Stub widget{args ? ` · ${args}` : ''}</span>
      <button type="button" onClick={close} className="rounded-sm border border-border px-2 text-ui-sm">
        Close
      </button>
    </div>
  );
}

export function EditorHarness() {
  const [pane, setPane] = useState<EditorPane | null>(null);
  const [doc, setDoc] = useState<ComposerDoc | null>(null);
  const handle = useRef<EditorHandle>(null);
  const submissions = useRef<EditorSubmission[]>([]);

  useEffect(() => {
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    const off = connectKeys();
    window.__maws_editor = {
      show: (next) => setPane(next),
      registerWidget: (name) => void registerSlashWidget(name as WidgetCommandName, { title: `/${name} widget`, component: StubWidget }),
      serialize: () => handle.current?.serialize() ?? null,
      attachments: () => (handle.current ? attachmentsOf(handle.current.doc()).map((a) => ({ kind: a.kind, name: a.name, mediaType: a.mediaType })) : []),
      submissions: () => [...submissions.current],
    };
    return () => {
      off();
      delete window.__maws_editor;
    };
  }, []);

  // The session's transcript, so ArrowUp recalls its prompts and the placeholder knows a turn happened.
  const appSessionId = (pane?.appSessionId ?? null) as AppSessionId | null;
  useEffect(() => {
    if (appSessionId === null) return;
    const store = useTranscriptStore.getState();
    void store.attach(appSessionId, ipcSource(appSessionId));
    return () => store.detach(appSessionId);
  }, [appSessionId]);

  return (
    <main className="flex h-full flex-col gap-3 overflow-auto bg-bg p-6 text-ui text-fg">
      {pane === null || appSessionId === null ? (
        <p className="m-0 text-fg-faint">No session</p>
      ) : (
        <section aria-label="composer" className="mx-auto flex w-full max-w-[720px] flex-col gap-2 rounded-lg border border-border bg-bg-raised p-3">
          <Editor
            key={appSessionId}
            appSessionId={appSessionId}
            cwd={pane.cwd}
            additionalDirectories={pane.additionalDirectories}
            sessionId={pane.sessionId}
            handle={handle}
            onDocChange={setDoc}
            onSubmit={async (s, how) => {
              const accepted = await submitSerialized(ipc, appSessionId, s, how, memoryTargetOf(useComposerStore.getState(), appSessionId));
              submissions.current.push({ mode: s.mode, how, content: s.content, display: s.display, accepted });
              return accepted;
            }}
          />
          <div className="flex items-center gap-2 text-ui-sm text-fg-muted">
            <PlusMenu cwd={pane.cwd} editor={handle} />
            <ul aria-label="attachments" className="m-0 flex list-none gap-2 p-0">
              {(doc ? attachmentsOf(doc) : []).map((a) => (
                <li key={a.id} className="rounded-sm border border-border px-1.5">
                  {a.name}
                  {a.persisted ? '' : ' · not kept in draft'}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}

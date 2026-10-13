// The `artifact` main tab (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M3; Decision Log 7, 8, 15): one artifact
// in its kind's registered editor (`Main`, else `Panel`), mounted with the state the editor made for this tab and the
// tab's X32 scope, under which the editor registers its own header. The tab's ref names the artifact alone; its kind,
// title and facts are its row in main's index (`library.get`), watched while the tab is open. While the index has no
// row for it, the host's (`artifacts.get`) says whether the index has not caught up yet (an artifact created a moment
// ago, an index that is unavailable), and the tab shows it from the host's row, or whether it is gone.
//
// The state lives as long as the tab shows the artifact (the registry's hold, disposed when the tab leaves the main area),
// not as long as the body is mounted, so the editor's closeGuard and actions read it while the tab is inactive (X32's
// lifetime rule). When the tab cannot show an editor (the artifact is gone, or its kind has no editor yet) the state is
// given back and the notice registers a header of its own, which replaces the editor's quietly (its body has unmounted),
// so no stale closeGuard holds the tab.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { ArtifactRow } from '@shared/ipc/schema/artifacts';
import type { TabRef } from '@shared/ipc/schema/layout';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { formatAgo } from '../app/date-format';
import { useNow } from '../app/use-now';
import { holdArtifactEditorState, releaseArtifactEditorState, useArtifactEditor, type RegisteredArtifactEditor } from '../artifacts/registry';
import { ipc } from '../ipc/client';
import { registerReplaceVerdict } from '../keymap/actions-runtime';
import { editorHostOf, useEditorHost, type EditorHostScope } from '../panel/editor-host';
import type { ReplaceVerdict } from '../stores/layout';
import { markArtifactViewed } from './actions';
import { KIND_LABELS, LIBRARY_COPY } from './copy';
import { library, libraryRow, refreshLibrary, useLibraryRow, type LibraryRead } from './store';

type ArtifactTabRef = Extract<TabRef, { kind: 'artifact' }>;

// The holds a markViewed was sent for: one per showing of an artifact in a tab (Decision Log 15, once per open).
const viewed = new WeakSet<object>();

export function ArtifactTab({ tab }: { tab: ArtifactTabRef }) {
  const scope = useMemo<EditorHostScope>(() => ({ surface: 'main', tabId: tab.id }), [tab.id]);
  const read = useLibraryRow(tab.artifactId);
  const fromHost = useHostRow(tab.artifactId, read);
  const artifact = read.value ?? (read.value === null ? fromHost : undefined);
  const editor = useArtifactEditor(artifact?.kind ?? null);
  if (artifact && editor) return <MountedEditor artifactId={artifact.id} kind={artifact.kind} editor={editor} scope={scope} />;
  if (artifact) return <NoEditor artifact={artifact} scope={scope} />;
  if (artifact === null) return <Gone scope={scope} />;
  if (read.status === 'error') {
    return (
      <Quiet>
        <p className="m-0">{LIBRARY_COPY.readFailed(read.error ?? '')}</p>
        <button type="button" onClick={() => refreshLibrary()} className={TEXT_BUTTON}>
          {LIBRARY_COPY.retry}
        </button>
      </Quiet>
    );
  }
  return (
    <Quiet>
      <p className="m-0">{LIBRARY_COPY.reading}</p>
    </Quiet>
  );
}

// While main's index answers no row: the host's row (null when it has none either; undefined until it answers), asked
// again at each settled read of the index that still has none, the last answer standing meanwhile.
function useHostRow(artifactId: string, read: LibraryRead<LibraryRow | null>): ArtifactRow | null | undefined {
  const [answer, setAnswer] = useState<{ artifactId: string; row: ArtifactRow | null } | null>(null);
  const settledAbsent = read.value === null && read.status === 'ready' ? read : null;
  useEffect(() => {
    if (settledAbsent === null) return;
    let live = true;
    void ipc.invoke('artifacts.get', { artifactId }).then((result) => {
      if (live) setAnswer({ artifactId, row: result.ok ? result.value.artifact : null });
    });
    return () => {
      live = false;
    };
  }, [artifactId, settledAbsent]);
  return answer?.artifactId === artifactId ? answer.row : undefined;
}

function MountedEditor({ artifactId, kind, editor, scope }: { artifactId: string; kind: ArtifactKind; editor: RegisteredArtifactEditor; scope: EditorHostScope }) {
  const hold = holdArtifactEditorState(scope, artifactId, kind, editor);
  useEffect(() => {
    if (viewed.has(hold)) return;
    viewed.add(hold);
    void markArtifactViewed(hold.artifactId);
  }, [hold]);
  const Main = editor.Main;
  return (
    <div data-artifact-tab={artifactId} className="h-full">
      <Main artifactId={artifactId} state={hold.state} scope={scope} />
    </div>
  );
}

// The tab shows no editor: whatever state an editor held for it goes, and the header is the notice's.
function useNoEditor(scope: EditorHostScope, title: string): void {
  useEffect(() => releaseArtifactEditorState(scope), [scope]);
  useEditorHost(scope, { title });
}

// The facts the tab has: the index's row in full, or the host's entity alone while the index catches up.
function NoEditor({ artifact, scope }: { artifact: LibraryRow | ArtifactRow; scope: EditorHostScope }) {
  useNoEditor(scope, artifact.title);
  const now = useNow();
  const row = 'sessions' in artifact ? artifact : null;
  const lastEditor = row?.lastEditor.kind === 'session' ? row.lastEditor.appSessionId : null;
  const by = row && actorDisplay(row.lastEditor, row.sessions.find((s) => s.appSessionId === lastEditor)?.title).name;
  return (
    <Quiet>
      <p className="m-0 text-fg">{LIBRARY_COPY.noEditor(artifact.kind)}</p>
      <dl data-artifact-facts className="m-0 flex flex-col items-center gap-1 text-ui-sm">
        <dt className="sr-only">Title</dt>
        <dd className="m-0 font-medium text-fg">{artifact.title}</dd>
        <dt className="sr-only">Kind</dt>
        <dd className="m-0">{[KIND_LABELS[artifact.kind], row?.space && LIBRARY_COPY.inSpace(row.space.name), row?.project?.name].filter(Boolean).join(' · ')}</dd>
        {row && by && (
          <>
            <dt className="sr-only">Last edit</dt>
            <dd className="m-0">{LIBRARY_COPY.edited(formatAgo(Math.max(0, now - row.lastEditedAt)), by)}</dd>
          </>
        )}
      </dl>
    </Quiet>
  );
}

function Gone({ scope }: { scope: EditorHostScope }) {
  useNoEditor(scope, LIBRARY_COPY.goneTitle);
  return (
    <Quiet>
      <p className="m-0">{LIBRARY_COPY.gone}</p>
    </Quiet>
  );
}

// E11 F2b's replace rule for this kind: a session opened over an unpinned `artifact` tab takes its place unless the
// editor's header says its changes are not saved yet (saving, unsaved, or waiting to reconnect), when the tab stays and
// the session opens beside it, as an unsaved file's does. Replacing skips the closeGuard, so the sync answer is the
// header's saved state.
export function artifactReplaceVerdict(ref: TabRef): ReplaceVerdict {
  if (ref.kind !== 'artifact') return null;
  const saved = editorHostOf({ surface: 'main', tabId: ref.id })?.saved;
  if (saved !== 'saving' && saved !== 'unsaved' && saved !== 'reconnecting') return null;
  const title = libraryRow(library.getState(), ref.artifactId).value?.title ?? LIBRARY_COPY.fallbackTitle;
  return { keep: saved === 'saving' ? LIBRARY_COPY.beingSaved(title) : LIBRARY_COPY.unsaved(title) };
}

// App.tsx's P3-L block: the kind's tab-level handlers.
export const registerArtifactTabs = (): (() => void) => registerReplaceVerdict('artifact', artifactReplaceVerdict);

const TEXT_BUTTON =
  'rounded-sm border border-border-strong px-2.5 py-1 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';

function Quiet({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ui text-fg-muted">{children}</div>;
}

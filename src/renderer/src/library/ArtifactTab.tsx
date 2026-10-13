// The `artifact` main tab (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M3; Decision Log 7, 8, 15): one artifact
// in its kind's registered editor (`Main`, else `Panel`), mounted with the state the editor made for this tab and the
// tab's X32 scope, under which the editor registers its own header. The tab's ref names the artifact alone; its kind,
// title and facts are its row in main's index (`library.get`), watched while the tab is open. While the index has no
// row for it, the host's (`artifacts.get`) says whether the index has not caught up yet (an artifact created a moment
// ago, an index that is unavailable), and the tab shows it from the host's row, or whether it is gone. A host that
// cannot answer (a timeout, a restart) is no word at all: the tab keeps what it showed, its editor and guards included,
// with a quiet Retry; only a confirmed absence shows the gone notice and gives the editor's state back.
//
// The state lives as long as the tab shows the artifact (the registry's hold, disposed when the tab leaves the main area),
// not as long as the body is mounted, so the editor's closeGuard and actions read it while the tab is inactive (X32's
// lifetime rule). When the tab cannot show an editor (the artifact is gone, or its kind has no editor yet) the state is
// given back and the notice registers a header of its own, which replaces the editor's quietly (its body has unmounted),
// so no stale closeGuard holds the tab.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { ArtifactRow } from '@shared/ipc/schema/artifacts';
import type { TabRef } from '@shared/ipc/schema/layout';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { formatAgo } from '../app/date-format';
import { useNow } from '../app/use-now';
import { heldArtifactEditorState, holdArtifactEditorState, releaseArtifactEditorState, useArtifactEditor, type RegisteredArtifactEditor } from '../artifacts/registry';
import { ipc } from '../ipc/client';
import { registerReplaceVerdict } from '../keymap/actions-runtime';
import { editorHostOf, useEditorHost, type EditorHostScope } from '../panel/editor-host';
import { useHosts } from '../stores/hosts';
import type { ReplaceVerdict } from '../stores/layout';
import { markArtifactViewed } from './actions';
import { KIND_LABELS, LIBRARY_COPY } from './copy';
import { library, libraryRow, refreshLibrary, useLibraryRow, type LibraryRead } from './store';

type ArtifactTabRef = Extract<TabRef, { kind: 'artifact' }>;

// The holds a markViewed was sent for: one per showing of an artifact in a tab (Decision Log 15, once per open).
const viewed = new WeakSet<object>();

export function ArtifactTab({ tab }: { tab: ArtifactTabRef }) {
  const scope = useMemo<EditorHostScope>(() => ({ surface: 'main', tabId: tab.id }), [tab.id]);
  return <ArtifactView artifactId={tab.artifactId} scope={scope} />;
}

// One artifact shown in a tab's scope, by whichever surface holds it: an `artifact` main tab mounts the kind's `Main`,
// the panel's Artifacts tool (its record view, M5) the kind's `Panel`. The surface gives the editor's state back when it
// stops showing the artifact (a main tab when it leaves the main area, the panel at Back, a re-target and disposal).
export function ArtifactView({ artifactId, scope }: { artifactId: string; scope: EditorHostScope }) {
  const read = useLibraryRow(artifactId);
  const host = useHostAnswer(artifactId, read);
  const indexless = read.value === null;
  const artifact = read.value ?? (indexless && host.answer?.status === 'present' ? host.answer.row : undefined);
  // What the tab showed until now, kept while the artifact cannot be confirmed (the host unreachable, or still asked).
  const kept = heldArtifactEditorState(scope);
  const held = kept?.artifactId === artifactId ? kept : null;
  const editor = useArtifactEditor(artifact?.kind ?? held?.kind ?? null);
  if (artifact && editor) return <MountedEditor artifactId={artifact.id} kind={artifact.kind} editor={editor} scope={scope} />;
  if (artifact) return <NoEditor artifact={artifact} scope={scope} />;
  if (indexless && host.answer?.status === 'absent') return <Gone scope={scope} />;
  // Unconfirmed: the index has no row (or its read failed) and the host has not said the artifact is gone.
  const problem = indexless && host.answer?.status === 'refused' ? LIBRARY_COPY.hostUnreachable(host.answer.error) : read.status === 'error' ? LIBRARY_COPY.readFailed(read.error ?? '') : null;
  const retry = () => {
    refreshLibrary();
    host.retry();
  };
  const notice = problem !== null && (
    <>
      <p className="m-0">{problem}</p>
      <button type="button" onClick={retry} className={TEXT_BUTTON}>
        {LIBRARY_COPY.retry}
      </button>
    </>
  );
  if (held && editor && held.editor === editor) {
    return (
      <MountedEditor artifactId={held.artifactId} kind={held.kind} editor={editor} scope={scope}>
        {notice && <div role="status" className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-raised px-3 py-1.5 text-ui-sm text-fg-muted">{notice}</div>}
      </MountedEditor>
    );
  }
  return <Quiet>{notice || <p className="m-0">{LIBRARY_COPY.reading}</p>}</Quiet>;
}

type HostAnswer = { status: 'present'; row: ArtifactRow } | { status: 'absent' } | { status: 'refused'; error: string };

// While main's index answers no row, the host's word on the artifact: present (the index has not caught up: just
// created, or the index unavailable), absent (confirmed gone), or refused (a timeout, a restarting host: no word at
// all). Asked again at each settled read of the index that still has none, at Retry, and when the engine host is
// ready again; the last answer stands meanwhile.
function useHostAnswer(artifactId: string, read: LibraryRead<LibraryRow | null>): { answer: HostAnswer | undefined; retry(): void } {
  const [answer, setAnswer] = useState<{ artifactId: string; answer: HostAnswer } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const hostReady = useHosts((s) => (s.hosts.engine?.state === 'ready' ? s.hosts.engine.revision : null));
  const settledAbsent = read.value === null && read.status === 'ready' ? read : null;
  useEffect(() => {
    if (settledAbsent === null) return;
    let live = true;
    void ipc.invoke('artifacts.get', { artifactId }).then((result) => {
      if (!live) return;
      const next: HostAnswer = !result.ok ? { status: 'refused', error: result.error.message } : result.value.artifact ? { status: 'present', row: result.value.artifact } : { status: 'absent' };
      setAnswer({ artifactId, answer: next });
    });
    return () => {
      live = false;
    };
  }, [artifactId, settledAbsent, attempt, hostReady]);
  return { answer: answer?.artifactId === artifactId ? answer.answer : undefined, retry: () => setAttempt((n) => n + 1) };
}

function MountedEditor({ artifactId, kind, editor, scope, children }: { artifactId: string; kind: ArtifactKind; editor: RegisteredArtifactEditor; scope: EditorHostScope; children?: ReactNode }) {
  const hold = holdArtifactEditorState(scope, artifactId, kind, editor);
  // Decision Log 15: the owner's view, recorded at the editor's first word that the content is on screen, once per showing.
  const onShown = useCallback(() => {
    if (viewed.has(hold)) return;
    viewed.add(hold);
    void markArtifactViewed(hold.artifactId);
  }, [hold]);
  const Body = scope.surface === 'panel' ? editor.Panel : editor.Main;
  return (
    <div data-artifact-tab={scope.surface === 'main' ? artifactId : undefined} className="flex h-full flex-col">
      {children}
      <div className="relative min-h-0 flex-1">
        <Body artifactId={artifactId} state={hold.state} scope={scope} onShown={onShown} />
      </div>
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

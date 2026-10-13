// "Make something new" (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; Decision Log 13): one card per kind. A
// kind with a registered editor makes `Untitled <kind>` in the Space the view is narrowed to and opens it in a main tab;
// the File card adds a file from the Mac (the native picker, then `artifacts.create` with its path, the file in place);
// the HTML card has no blank page to offer. Every card can ask Claude instead, the route Claude's own cards take: a new
// chat in the focused project with the composer's opening words ("Make a <kind>: "). A kind whose editor has not
// landed shows only Ask Claude, and gains New the moment its editor registers.
import type { ArtifactKind } from '@shared/artifacts/entity';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import { artifactEditorFor, useArtifactEditor } from '../artifacts/registry';
import { ipc } from '../ipc/client';
import { createSession, focusedProject, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { prefillComposer } from '../stores/composer';
import { createArtifact, openArtifactTab } from './actions';
import { askClaudePrefill, KIND_BLURBS, KIND_LABELS, LIBRARY_PAGE as P, untitledTitle } from './copy';
import { toastFailure } from './dialogs';
import { KindIcon } from './icons';

const BUTTON = 'rounded-sm px-2 py-0.5 text-left text-ui-sm outline-accent focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

// Made, then opened in a tab when its kind has an editor to show it.
async function make(input: Parameters<typeof createArtifact>[0]): Promise<void> {
  const result = await createArtifact(input);
  if (!result.ok) return toastFailure(result.error.message);
  if (artifactEditorFor(result.value.kind)) openArtifactTab(result.value.id);
}

async function addFile(spaceId: string | null): Promise<void> {
  const picked = await ipc.invoke('layout.pickFiles', { kind: 'files', directory: null, multiple: false, pathsOnly: true });
  if (!picked.ok) return toastFailure(picked.error.message);
  const file = picked.value.files[0];
  if (!file) return; // cancelled
  await make({ kind: 'file', title: file.name, content: { path: file.path }, ...(spaceId !== null && { spaceId }) });
}

async function askClaude(kind: ArtifactKind): Promise<void> {
  const appSessionId = await createSession(focusedProject());
  if (appSessionId !== null) prefillComposer(appSessionId, { text: askClaudePrefill(kind) });
}

function KindCard({ kind, spaceId }: { kind: ArtifactKind; spaceId: string | null }) {
  const editor = useArtifactEditor(kind);
  const canAsk = useSessionCreatorRegistered();
  const label = KIND_LABELS[kind];
  const primary =
    kind === 'file' ? (
      <button type="button" onClick={() => void addFile(spaceId)} className={`${BUTTON} text-fg hover:bg-bg-hover`}>
        {P.addFile}
      </button>
    ) : editor && kind !== 'html' ? (
      <button
        type="button"
        aria-label={`${P.create} ${label.toLowerCase()}`}
        onClick={() => void make({ kind, title: untitledTitle(kind), ...(spaceId !== null && { spaceId }) })}
        className={`${BUTTON} text-fg hover:bg-bg-hover`}
      >
        {P.create}
      </button>
    ) : null;
  return (
    <div role="group" aria-label={label} title={KIND_BLURBS[kind]} data-make-kind={kind} className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-bg-raised p-2.5">
      <span className="flex min-w-0 items-center gap-2 px-0.5">
        <span aria-hidden className="text-fg-muted">
          <KindIcon kind={kind} />
        </span>
        <span className="truncate text-ui font-medium text-fg">{label}</span>
      </span>
      <span className="-mx-0.5 flex flex-col items-start">
        {primary}
        <button
          type="button"
          disabled={!canAsk}
          aria-label={`${P.askClaude} to make ${askClaudePrefill(kind).slice('Make '.length, -2)}`}
          onClick={() => void askClaude(kind)}
          className={`${BUTTON} text-fg-muted hover:bg-bg-hover hover:text-fg`}
        >
          {P.askClaude}
        </button>
      </span>
    </div>
  );
}

export function MakeSomethingNew({ spaceId }: { spaceId: string | null }) {
  return (
    <section aria-labelledby="library-make" className="flex flex-col gap-2 pb-4">
      <h2 id="library-make" className="m-0 px-2 text-ui-sm font-semibold text-fg-muted">
        {P.makeNew}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
        {ARTIFACT_KINDS.map((kind) => (
          <KindCard key={kind} kind={kind} spaceId={spaceId} />
        ))}
      </div>
    </section>
  );
}

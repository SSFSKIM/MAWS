// The Design System page as the kind's editor (P3-D M6; docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D14,
// Decision Log 3, 18 and 25; L's registry, the P3 interface ledger §7): registered through `registerArtifactEditor(
// 'design_system', …)`, so the library's `artifact` main tab and the panel's Artifacts tool mount it.
//
// The tab owns the system's replica (`createState` opens it through the window's ArtifactHost, `dispose` closes it), so
// the header's actions, which outlive the body (X32), never read the body's state. The body (DesignSystemBody) gets the
// app's handlers: "Set as my default" writes settings 14, "Delete design system…" asks the showing's state for the delete
// sheet (so a re-target or a disposal ends the request with the showing), and a system with no law asks the agent to adopt it by adding the request to the shown session's
// message box (P3-G's composer queue, which never replaces a draft). `onShown` is called once the system is on screen
// and the body is visible; L's surface records the view.
import { useSyncExternalStore } from 'react';
import type { ArtifactHost, DocumentHandle } from '@artifacts/host';
import { usePageState } from '@artifacts/design-system/page/use-system';
import { shownSession } from '../../panel/host';
import { EditorHostScopeContext } from '../../panel/editor-host';
import { writeSettings } from '../../settings-tab/parts';
import { queueComposerAttachment } from '../../stores/composer';
import { useLayout } from '../../stores/layout';
import { toast } from '../../stores/notices';
import { useSettings } from '../../stores/settings';
import { artifactHost } from '..';
import { registerArtifactEditor, type ArtifactEditor, type ArtifactEditorProps } from '../registry';
import { DESIGN_SYSTEM_COPY as C } from './copy';
import { DeleteSystemSheet } from './DeleteSystemSheet';
import { DesignSystemBody } from './DesignSystemBody';

type Opening = { status: 'opening' } | { status: 'open'; handle: DocumentHandle } | { status: 'failed'; error: string };

/** A tab's open system: its replica from the first showing until the surface stops showing it, and whether the owner
 * asked to delete it (the header's action outlives the body, X32; the request ends with the showing). */
export class OpenedSystem {
  private current: Opening = { status: 'opening' };
  private deleteAsked = false;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    readonly artifactId: string,
    readonly host: ArtifactHost,
  ) {
    host.open(artifactId).then(
      (handle) => {
        if (this.disposed) return handle.close(); // the tab went while it opened
        this.set({ status: 'open', handle });
      },
      (error: unknown) => {
        if (!this.disposed) this.set({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
      },
    );
  }

  readonly get = (): Opening => this.current;
  readonly deleting = (): boolean => this.deleteAsked;
  requestDelete(): void {
    if (this.disposed || this.deleteAsked) return;
    this.deleteAsked = true;
    this.changed();
  }
  endDelete(): void {
    if (!this.deleteAsked) return;
    this.deleteAsked = false;
    this.changed();
  }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deleteAsked = false;
    if (this.current.status === 'open') this.current.handle.close();
    this.listeners.clear();
  }

  private set(next: Opening): void {
    this.current = next;
    this.changed();
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export interface DesignSystemEditorDeps {
  host(): ArtifactHost;
}

export function createDesignSystemEditor(deps: DesignSystemEditorDeps): ArtifactEditor<OpenedSystem> {
  return {
    Panel: DesignSystemPanel,
    createState: ({ artifactId }) => new OpenedSystem(artifactId, deps.host()),
    dispose: (state) => state.dispose(),
  };
}

/** App.tsx's P3-D block: the kind's editor in L's registry. */
export const registerDesignSystemEditor = (deps: DesignSystemEditorDeps = { host: artifactHost }): (() => void) =>
  registerArtifactEditor('design_system', createDesignSystemEditor(deps));

function DesignSystemPanel({ artifactId, state, scope, visible, onShown }: ArtifactEditorProps<OpenedSystem>) {
  const opening = useSyncExternalStore(state.subscribe, state.get);
  if (opening.status === 'opening') return <Quiet>{C.opening}</Quiet>;
  if (opening.status === 'failed') return <Quiet>{C.openFailed(opening.error)}</Quiet>;
  return (
    <EditorHostScopeContext.Provider value={scope}>
      <OpenBody artifactId={artifactId} handle={opening.handle} state={state} visible={visible} onShown={onShown} />
    </EditorHostScopeContext.Provider>
  );
}

function OpenBody(props: { artifactId: string; handle: DocumentHandle; state: OpenedSystem; visible: boolean; onShown(): void }) {
  const { artifactId, handle, state, visible, onShown } = props;
  const name = usePageState(handle.doc).system.meta?.name ?? C.untitled;
  const isDefault = useSettings((s) => s.state?.settings.artifacts.defaultDesignSystem === artifactId);
  const deleting = useSyncExternalStore(state.subscribe, state.deleting);
  const session = useLayout((s) => shownSession(s.main));
  const askAdopt = {
    unavailable: session === null ? C.noSession : null,
    onAsk: () => {
      if (session === null) return;
      queueComposerAttachment(session, { files: [], text: C.adoptRequest(name, artifactId) });
      toast({ level: 'info', text: C.adoptAsked, actions: [], dismissible: true });
    },
  };
  return (
    <>
      <DesignSystemBody
        artifactId={artifactId}
        handle={handle}
        host={state.host}
        visible={visible}
        onShown={onShown}
        isDefault={isDefault}
        onSetDefault={() => void writeSettings({ artifacts: { defaultDesignSystem: artifactId } })}
        onDelete={() => state.requestDelete()}
        askAdopt={askAdopt}
      />
      {deleting && visible && <DeleteSystemSheet artifactId={artifactId} name={name} onClose={() => state.endDelete()} />}
    </>
  );
}

function Quiet({ children }: { children: string }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-ui text-fg-muted">{children}</div>;
}

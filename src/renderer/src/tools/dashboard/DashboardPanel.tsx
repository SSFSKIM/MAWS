// The dashboard editor in the panel's Artifacts tool and an `artifact` main tab (P3-E2 M3; X32, E's Decision Log 19): B's
// document body over the tab's DocumentTabState, given the dashboard's chart renderer, its kind and its Datasets header
// action, with the source sheet beside it as the dashboard's own overlay; M4: a selected view is commented whole, under
// its view and caption (E's Decision Log 28). A dashboard made before dashboards were
// documents (held legacy content: files and no tab) is shown as held, its files named with the way forward, never as an
// editable blank document. E3 M3: the body reports whether it is on screen with its window's document visible (its tab's
// live datasets are shown only then) and gives the sheet the tab's live datasets. E3 panel residual: its unmount (an
// inactive tab, a closed surface), unlike its window hiding, ends whatever preview it displayed for the tab's holds.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { blockCommentQuote } from '@artifacts/dashboard/comments';
import { legacyDashboardFiles } from '@artifacts/dashboard/legacy';
import { SourceSheet } from '@artifacts/dashboard/editor/SourceSheet';
import { onUpdate, type Doc } from '@artifacts/yjs';
import type { ArtifactEditorProps } from '../../artifacts/registry';
import { useEditorHost, type EditorHostAction } from '../../panel/editor-host';
import { DocumentBody } from '../document/DocumentPanel';
import { useDocumentVisible } from '../artifacts/viewers/connectors/use-document-visible'; // E3: H's trusted document visibility
import { DatasetsIcon } from './icons';
import { FileSources } from './FileSources';
import type { DashboardTabState } from './tab-state';

export type DashboardEditorProps = ArtifactEditorProps<DashboardTabState>;

export function DashboardPanel(props: DashboardEditorProps) {
  return <DashboardBody {...props} surface="panel" />;
}

export function DashboardMain(props: DashboardEditorProps) {
  return <DashboardBody {...props} surface="main" />;
}

const NO_FILES = (): string[] | null => null;

/** The files of a held legacy dashboard, followed as its document changes (a restore can make it one, or not). */
function useHeldFiles(doc: Doc | null): string[] | null {
  const read = useMemo(() => {
    if (!doc) return NO_FILES;
    let key = '';
    let value: string[] | null = null;
    return () => {
      const files = legacyDashboardFiles(doc);
      const next = files ? files.join('\n') : '';
      if (next !== key) {
        key = next;
        value = files;
      }
      return value;
    };
  }, [doc]);
  return useSyncExternalStore((listener) => (doc ? onUpdate(doc, () => listener()) : () => {}), read);
}

function DashboardBody({ state, surface, ...props }: DashboardEditorProps & { surface: 'panel' | 'main' }) {
  // E3 M3: the live datasets shown only while this body is on screen and its window's document is visible
  const shown = useDocumentVisible() && props.visible;
  useEffect(() => state.setBodyShown(shown), [state, shown]);
  useEffect(
    () => () => {
      state.setBodyShown(false);
      state.bodyUnmounted(); // E3 panel residual: the body went (not its window hiding): any preview's hold goes with it
    },
    [state],
  );
  const document = useSyncExternalStore(state.document.subscribe, state.document.snapshot);
  const sheet = useSyncExternalStore(state.sheet.subscribe, state.sheet.snapshot);
  const held = useHeldFiles(document.handle?.doc ?? null);
  const actions = useMemo<readonly EditorHostAction[]>(() => [{ id: 'datasets', label: 'Datasets', icon: DatasetsIcon, pressed: sheet.open, onSelect: () => state.toggleDatasets() }], [state, sheet.open]);
  if (held) return <HeldDashboard {...props} state={state} files={held} />;
  return (
    <div className="dash-shell">
      <FileSources doc={document.handle?.doc ?? null} shown={shown && !document.previewing && !document.document?.readOnly} api={state.fileSources} />
      <DocumentBody {...props} state={state.document} surface={surface} renderChart={state.renderChart} artifactKind="dashboard" additionalActions={actions} onDisplayedDocument={state.displayed} blockCommentQuote={blockCommentQuote} />
      <SourceSheet artifactId={props.artifactId} sheet={state.sheet} reader={state.reader} host={state.document.host} actorName={state.actorName} live={state.live} onReopen={state.reopenSheet} />
    </div>
  );
}

function HeldDashboard({ state, scope, visible, onShown, files }: Omit<DashboardEditorProps, 'artifactId'> & { files: string[] }) {
  const { title } = useSyncExternalStore(state.document.subscribe, state.document.snapshot);
  useEditorHost(scope, { title: title || 'Dashboard', saved: 'readonly' });
  useEffect(() => {
    if (visible && state.document.markShown()) onShown();
  }, [visible, state, onShown]);
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ui text-fg-muted">
      <p>This dashboard was made before dashboards were documents, so it is kept read-only, exactly as it is. It holds these files:</p>
      <ul className="font-mono text-code text-fg">
        {files.map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
      <p>To keep working on it, ask an agent to read its files and create a new dashboard from them, then delete this one.</p>
    </div>
  );
}

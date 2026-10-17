// The dashboard editor in the panel's Artifacts tool and an `artifact` main tab (P3-E2 M3; X32, E's Decision Log 19): B's
// document body over the tab's DocumentTabState, given the dashboard's chart renderer, its kind and its Datasets header
// action, with the source sheet beside it as the dashboard's own overlay; M4: a selected view is commented whole, under
// its view and caption (E's Decision Log 28). A dashboard made before dashboards were
// documents (held legacy content: files and no tab) is shown as held, its files named with the way forward, never as an
// editable blank document.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { blockCommentQuote } from '@artifacts/dashboard/comments';
import { legacyDashboardFiles } from '@artifacts/dashboard/legacy';
import { SourceSheet } from '@artifacts/dashboard/editor/SourceSheet';
import { onUpdate, type Doc } from '@artifacts/yjs';
import type { ArtifactEditorProps } from '../../artifacts/registry';
import { useEditorHost, type EditorHostAction } from '../../panel/editor-host';
import { DocumentBody } from '../document/DocumentPanel';
import { DatasetsIcon } from './icons';
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
  const document = useSyncExternalStore(state.document.subscribe, state.document.snapshot);
  const sheet = useSyncExternalStore(state.sheet.subscribe, state.sheet.snapshot);
  const held = useHeldFiles(document.handle?.doc ?? null);
  const actions = useMemo<readonly EditorHostAction[]>(() => [{ id: 'datasets', label: 'Datasets', icon: DatasetsIcon, pressed: sheet.open, onSelect: () => state.toggleDatasets() }], [state, sheet.open]);
  if (held) return <HeldDashboard {...props} state={state} files={held} />;
  return (
    <div className="dash-shell">
      <DocumentBody {...props} state={state.document} surface={surface} renderChart={state.renderChart} artifactKind="dashboard" additionalActions={actions} onDisplayedDocument={state.displayed} blockCommentQuote={blockCommentQuote} />
      <SourceSheet artifactId={props.artifactId} sheet={state.sheet} reader={state.reader} host={state.document.host} actorName={state.actorName} />
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

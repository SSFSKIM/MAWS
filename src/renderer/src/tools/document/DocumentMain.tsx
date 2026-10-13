// The document editor in an `artifact` main tab (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13): the
// panel's body, its comment card docked to the main surface.
import { DocumentBody, type DocumentEditorProps } from './DocumentPanel';

export function DocumentMain(props: DocumentEditorProps) {
  return <DocumentBody {...props} surface="main" />;
}

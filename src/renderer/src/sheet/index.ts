// The question sheet's components: the renderer half of the composite's X5 (the C3 plan's §G). A consumer imports this
// module and `src/shared/sheet/`, and nothing else of the sheet; it supplies a `SheetHost`, the model or the summaries,
// a place to keep each session's memory, and for styles the app's tokens (R/styles/app.css), the Markdown's two
// stylesheets (R/transcript/view/transcript.css, streamdown/styles.css) and a Tailwind `@source` naming this directory.
export { QuestionCard, type QuestionCardProps } from './QuestionCard';
export { OutcomeCard, type OutcomeCardProps } from './OutcomeCard';
export { SessionSheet, type SessionSheetProps } from './SessionSheet';
export { SheetOverview, type SheetOverviewProps } from './SheetOverview';
export { ReferenceView, type ReferenceViewProps } from './ReferenceView';
export { SheetMarkdown, sheetLinkAction, type SheetLinkAction, type SheetMarkdownProps } from './SheetMarkdown';
export type { SheetHost } from './host';
export { EMPTY_MEMORY, reconcile, type SentAct, type SheetMemory } from './memory';
export { SHEET_WORDS } from './copy';

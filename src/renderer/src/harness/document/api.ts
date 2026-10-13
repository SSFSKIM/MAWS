// The document harness's automation surface, `window.__maws_document` (P3-B M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): Playwright drives the `#document` page through it, since main
// blocks navigation within a launch. Types only, so the e2e project can import them.

/** One of the page's two replicas of the document, each with its own editor. */
export type Replica = 'a' | 'b';

export interface DocumentHarnessApi {
  /** True once both editors are bound to their replicas. */
  ready(): boolean;
  /** Counts the documents opened: the page's first is 1, each reset's the next. */
  generation(): number;
  /** Opens a fresh host document with the seed content, both replicas new; wait for the next generation's `ready()`. */
  reset(): void;
  /** A replica's active tab as the editor shows it (ProseMirror JSON). */
  json(replica: Replica): unknown;
  /** The host's copy of a tab (the first when not named), as ProseMirror JSON. */
  hostJson(tabId?: string): unknown;
  /** The text of the top-level block `id` in a replica's editor, or null. */
  blockText(replica: Replica, id: string): string | null;
  /** Selects `text` in the top-level block `id` of a replica's editor (M4: what Comment comments). */
  selectText(replica: Replica, id: string, text: string): void;
  /** The host's comment threads, oldest first: each one's id, status, quote and messages' bodies. */
  threads(): Array<{ id: string; status: 'open' | 'resolved'; quote: string; messages: string[] }>;
  /** Focuses a replica's editor with the caret at the end of block `id`; resolves once keys sent would land there. */
  caretAtEnd(replica: Replica, id: string): Promise<void>;
  /**
   * Focuses a replica's editor in a new empty paragraph at the end of the tab, as a click below the last block would;
   * resolves once keys sent would land there.
   */
  newLineAtEnd(replica: Replica): Promise<void>;
  /** Replica B types `text` at the end of block `id`, one character every `everyMs`, until stopped; a remote edit for A. */
  startRemoteTyping(id: string, text: string, everyMs: number): void;
  /** Stops it; resolves with the characters typed. */
  stopRemoteTyping(): string;
  /** M5: the agent session ("Fix the build") appends `text` to the top-level block `id`, written on the host. */
  agentAppend(id: string, text: string): void;
  /** M5: records a version of the host document as it is now, by the owner or the agent; its id. */
  version(kind: 'auto' | 'turn' | 'named', by: 'owner' | 'agent', fields?: { label?: string; note?: string; summary?: string }): number;
  /** M5: the version ids "Make a copy" was asked for, in order. */
  copies(): number[];
}

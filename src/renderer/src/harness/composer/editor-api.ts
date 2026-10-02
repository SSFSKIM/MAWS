// The editor harness's automation surface, `window.__maws_editor` (C7 execution document, M3): Playwright shows one
// session's editor and reads what it holds and what it submitted. Types only, so the e2e project can import them.
export interface EditorPane {
  appSessionId: string;
  cwd: string;
  additionalDirectories?: string[];
  sessionId: string | null; // the engine session id, for the pasted tags' id
}

export interface EditorSubmission {
  mode: 'send' | 'bash' | 'memory';
  content: unknown; // what went on the wire: a string or content blocks
  display: string;
  accepted: boolean;
}

export interface EditorHarnessApi {
  show(pane: EditorPane | null): void; // mounts (or unmounts) the editor for a session, keyed by it
  registerWidget(name: string): void; // a stub widget for a declared widget name (C11's registration, as the harness fakes it)
  serialize(): { mode: string; content: unknown; display: string; pastedContents: Record<string, { content: string | null }>; omitted: number } | null;
  attachments(): { kind: string; name: string; mediaType: string }[];
  submissions(): EditorSubmission[];
}

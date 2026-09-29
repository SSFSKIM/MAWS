// The editor's live context as its extensions, keys and popups read it (through a getter the Editor refreshes after
// every render), so a Tiptap instance created once always sees the current session, catalogue and callbacks.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionCatalog } from '../../stores/catalog';

export interface EditorEnv {
  appSessionId: AppSessionId;
  cwd: string;
  additionalDirectories: readonly string[];
  catalog: SessionCatalog;
  widgets: ReadonlySet<string>;
  placeholder: string;
  files(files: File[]): void; // pasted or dropped files, classified and attached, mentioned or read as text
  pasteText(text: string): boolean; // whether a pasted text became an atom
  openWidget(name: string, args: string): void;
}

// What a popup needs from it, handed over as plain props each time the suggestion plugin renders.
export type PopupContext = Pick<EditorEnv, 'cwd' | 'additionalDirectories' | 'catalog' | 'widgets' | 'openWidget'>;

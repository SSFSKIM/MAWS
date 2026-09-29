// A queued entry's inline editor (C7 execution document, M4: "the queue's inline edit reuses the same editor extensions
// in a one-line variant"): the composer's schema with its chip views, no menus, no history, no draft. Enter saves the
// document re-serialised as the composer would send it (the pasted atoms keep their bodies, the images their bytes);
// Escape cancels. The root is not a key sink: Enter and Escape are this editor's own, handled before C5's dispatcher
// could see them as a pane's (the dispatcher refuses text entry anyway).
import HardBreak from '@tiptap/extension-hard-break';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import type { ContentBlock } from '@shared/graph/events';
import type { SendContent } from '@shared/engine/session-state-store';
import { sendSizeRefusal } from '../editor/attachments';
import { MentionView } from '../editor/nodes/Mention';
import { PastedView } from '../editor/nodes/Pasted';
import { ComposerDocument, MentionNode, PastedNode } from '../editor/schema';
import { serializeDraft } from '../editor/serialize';
import { entryDoc } from './entry-text';

export interface QueueEditProps {
  content: string | readonly ContentBlock[];
  sessionId: string | null;
  cwd: string;
  onSave(content: SendContent): Promise<boolean>; // whether the host took the edit (the editor closes)
  onCancel(): void;
}

export function QueueEdit({ content, sessionId, cwd, onSave, onCancel }: QueueEditProps) {
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const latest = useRef({ onCancel, save: async () => {} });

  const [options] = useState(() => ({
    extensions: [
      ComposerDocument,
      Paragraph,
      Text,
      HardBreak,
      MentionNode.extend({ addNodeView: () => ReactNodeViewRenderer(MentionView, { as: 'span' }) }),
      PastedNode.extend({ addNodeView: () => ReactNodeViewRenderer(PastedView, { as: 'span' }) }),
      UndoRedo,
    ],
    content: entryDoc(content),
    immediatelyRender: true,
    autofocus: 'end' as const,
    editorProps: {
      attributes: { 'aria-label': 'Edit queued message', role: 'textbox', class: 'min-h-5 outline-none' },
      handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
        if (event.isComposing || view.composing) return false;
        if (event.key === 'Escape') {
          event.preventDefault();
          latest.current.onCancel();
          return true;
        }
        if (event.key !== 'Enter' || event.shiftKey) return false;
        event.preventDefault();
        void latest.current.save();
        return true;
      },
    },
  }));
  const editor = useEditor(options);

  const save = async () => {
    if (saving.current || !editor) return;
    const s = serializeDraft(editor.getJSON(), { sessionId, cwd });
    if (s.empty) return setError('A queued message cannot be empty · Delete it instead');
    const refusal = sendSizeRefusal(s.content);
    if (refusal) return setError(refusal);
    saving.current = true;
    try {
      if (!(await onSave(s.content))) setError('The edit was not saved');
    } finally {
      saving.current = false;
    }
  };

  useEffect(() => void (latest.current = { onCancel, save }));

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <EditorContent editor={editor} className="rounded-sm border border-border-strong bg-bg px-1.5 py-0.5 text-ui text-fg" />
      {error ? (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {error}
        </p>
      ) : (
        <p className="m-0 text-ui-sm text-fg-faint">Enter saves · Esc cancels</p>
      )}
    </div>
  );
}

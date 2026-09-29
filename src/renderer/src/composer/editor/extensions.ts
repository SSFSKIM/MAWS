// The interactive extension set (C7 execution document, "Document model and serialisation"): the schema of
// `schema.ts` with React node views for the two atoms, the placeholder, undo, the `@` and `/` suggestion triggers with
// the terminal's own rules (`@` after a space, a newline or CJK punctuation; `/` at the start of a line only, so a `/`
// mid-sentence is a character), the file handler for pasted and dropped files, and the text paste rule (past 1,024
// characters or 10 lines a paste becomes an atom; below, the text goes in line for line). Keys are the editor's own view props (`keys.ts`), not an extension,
// so they run before any plugin's. The editor's live context reaches every callback through one getter.
import { Extension, type AnyExtension, type Editor, type Range } from '@tiptap/core';
import FileHandler from '@tiptap/extension-file-handler';
import type { MentionOptions } from '@tiptap/extension-mention';
import HardBreak from '@tiptap/extension-hard-break';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { AtMenu } from '../mentions/AtMenu';
import { suggestionRenderer, type PopupItem } from '../mentions/popup';
import { SlashPalette } from '../mentions/SlashPalette';
import { MentionView } from './nodes/Mention';
import { PastedView } from './nodes/Pasted';
import { handlesPlainText, plainTextSlice } from './clipboard';
import type { EditorEnv } from './env';
import { PASTED } from './doc';
import { ComposerDocument, MentionNode, PastedNode } from './schema';

export const atKey = new PluginKey('composer-at');
export const slashKey = new PluginKey('composer-slash');

// Whether an `@` or `/` popup is open (the editor's keys leave Enter and the arrows to it then).
export const suggesting = (editor: Editor): boolean => Boolean(atKey.getState(editor.state)?.active || slashKey.getState(editor.state)?.active);

const run = ({ editor, range, props }: { editor: Editor; range: Range; props: PopupItem }) => props.apply(editor, range);

// The text paste rule: a long plain-text paste becomes a pasted atom; a short one goes in line for line, blank lines kept.
// The editor's own copied slice is ProseMirror's to paste (its chips come back with their attributes).
const TextPaste = (env: () => EditorEnv) =>
  Extension.create({
    name: 'composerTextPaste',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('composerTextPaste'),
          props: {
            handlePaste: (view, event) => {
              const data = event.clipboardData;
              if (!data || data.files.length > 0) return false;
              const text = data.getData('text/plain');
              if (text === '' || !handlesPlainText({ html: data.getData('text/html') })) return false;
              if (env().pasteText(text)) return true;
              view.dispatch(view.state.tr.replaceSelection(plainTextSlice(view.state.schema, text)).scrollIntoView());
              return true;
            },
          },
        }),
      ];
    },
  });

// Each pasted atom's number in document order, as a node decoration its chip reads (inserting or deleting one before it
// renumbers it, as `display` and `pastedContents` do).
const PastedNumbers = Extension.create({
  name: 'composerPastedNumbers',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('composerPastedNumbers'),
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === PASTED) decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { pastedNumber: decorations.length + 1 }));
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export function composerExtensions(env: () => EditorEnv): AnyExtension[] {
  const at: Omit<SuggestionOptions<PopupItem, PopupItem>, 'editor'> = {
    char: '@',
    pluginKey: atKey,
    allowSpaces: false,
    allowedPrefixes: [' ', '\n', '。', '、', '？', '！'],
    items: () => [],
    command: run,
    render: suggestionRenderer(AtMenu, env, atKey),
  };
  const slash: Omit<SuggestionOptions<PopupItem, PopupItem>, 'editor'> = {
    char: '/',
    pluginKey: slashKey,
    startOfLine: true,
    items: () => [],
    command: run,
    render: suggestionRenderer(SlashPalette, env, slashKey),
  };
  return [
    ComposerDocument,
    Paragraph,
    Text,
    HardBreak,
    MentionNode.extend({ addNodeView: () => ReactNodeViewRenderer(MentionView, { as: 'span' }) }).configure({
      // the popups choose their own rows and apply them (`PopupItem.apply`), so the selected props are not mention attrs
      suggestions: [at, slash] as unknown as MentionOptions['suggestions'],
    }),
    PastedNode.extend({ addNodeView: () => ReactNodeViewRenderer(PastedView, { as: 'span' }) }),
    Placeholder.configure({ placeholder: () => env().placeholder }),
    UndoRedo,
    FileHandler.configure({
      consumePasteEvent: true,
      onPaste: (_editor, files) => env().files(files),
      onDrop: (_editor, files, pos) => env().files(files, pos),
    }),
    TextPaste(env),
    PastedNumbers,
  ];
}

// The composer's public surface (C7 execution document, Composer public surface): what C5, C6, C8, C10 and C11
// import. M2 landed the docked host (C10 docks its trust and relay-down cards through it), the prefill seam and the
// transcript's request renderers; M3 the slash widget registry C11 fills; M4 the Composer, its one app-level key
// handler, text insertion for C11, and the setup-intent seam C10 registers its hook through; M4b the fork seam C10
// registers its provider through and C6's edit-and-resubmit action (registered from App.tsx).
import type { MawsBridge } from '@shared/ipc/schema';
import { registerSlot } from '../app/slots';
import { registerBubbleEditor, registerTranscriptActions } from '../transcript';
import { Composer } from './Composer';
import { BubbleEdit } from './InlineEdit';
import { editAndResubmitRow, editPromptRow } from './resubmit-seam';

export { Composer, type ComposerProps } from './Composer';
export { ComposerAppKeys } from './ComposerAppKeys';
export { DictationKeys } from './dictation/DictationKeys'; // E9: the one dictation key and controller, mounted from App.tsx
export { DockedCardFrame, type DockedCardFrameProps } from './docked/DockedCardFrame';
export { dockCard, useDockedCards, type DockedCard } from './docked/registry';
export { insertComposerText, prefillComposer, useComposerStore, type Prefill } from '../stores/composer';
export { renderInlineRequest, renderSessionRequest } from '../request-card/inline';
export { registerSlashWidget, WIDGET_COMMANDS, type SlashWidget, type WidgetCommandName } from './mentions/widgets'; // M3
export { closeWidgetDialog, openWidgetDialog, WidgetDialogHost } from './WidgetDialog'; // W3 (C6): the widgets' floating dialog
export { editAndResubmitRow, editPromptRow, registerResubmitProvider, type ResubmitProvider } from './resubmit-seam'; // M4b; editPromptRow: W1
export { registerSetupIntentHook, type SetupIntent, type SetupIntentHook, type SetupIntentPatch, type Location, type ModelInfo, type FirstMessage } from './setup-intent';

// Called once from App.tsx's C7 block: the composer in C5's `composer` slot (C5's registry has no disposer).
export function connectComposer(): void {
  registerSlot('composer', Composer);
}

// W3 (B6): a bubble's Edit and a blocked prompt's Edit prompt edit the bubble in place, C7's editor standing in for it
// (the harness passes the client its composers use).
export function connectInlineEdit(client?: MawsBridge): () => void {
  const offs = [registerTranscriptActions({ editAndResubmit: editAndResubmitRow, editPrompt: editPromptRow }), registerBubbleEditor((props) => <BubbleEdit {...props} client={client} />)];
  return () => offs.forEach((off) => off());
}

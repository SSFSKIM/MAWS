// The composer's public surface (C7 execution document, Composer public surface): what C5, C6, C8, C10 and C11
// import. M2 landed the docked host (C10 docks its trust and relay-down cards through it), the prefill seam and the
// transcript's request renderers; M3 the slash widget registry C11 fills; M4 the Composer, its one app-level key
// handler, text insertion for C11, and the setup-intent seam C10 registers its hook through; M4b the fork seam C10
// registers its provider through and C6's edit-and-resubmit action (registered from App.tsx).
import { registerSlot } from '../app/slots';
import { Composer } from './Composer';

export { Composer, type ComposerProps } from './Composer';
export { ComposerAppKeys } from './ComposerAppKeys';
export { DockedCardFrame, type DockedCardFrameProps } from './docked/DockedCardFrame';
export { dockCard, useDockedCards, type DockedCard } from './docked/registry';
export { insertComposerText, prefillComposer, useComposerStore, type Prefill } from '../stores/composer';
export { renderInlineRequest, renderSessionRequest } from '../request-card/inline';
export { registerSlashWidget, WIDGET_COMMANDS, type SlashWidget, type WidgetCommandName } from './mentions/widgets'; // M3
export { editAndResubmitRow, editPromptRow, registerResubmitProvider, type ResubmitProvider } from './resubmit-seam'; // M4b; editPromptRow: W1
export { registerSetupIntentHook, type SetupIntent, type SetupIntentHook, type SetupIntentPatch, type Location, type ModelInfo, type FirstMessage } from './setup-intent';

// Called once from App.tsx's C7 block: the composer in C5's `composer` slot (C5's registry has no disposer).
export function connectComposer(): void {
  registerSlot('composer', Composer);
}

// The composer's public surface (C7 execution document, Composer public surface): what C5, C6, C8, C10 and C11
// import. M2 lands the docked host (C10 docks its trust and relay-down cards through it), the prefill seam and the
// transcript's request renderers; M3 and M4 add the editor and the Composer itself.
export { DockedCardFrame, type DockedCardFrameProps } from './docked/DockedCardFrame';
export { dockCard, useDockedCards, type DockedCard } from './docked/registry';
export { prefillComposer, useComposerStore, type Prefill } from '../stores/composer';
export { renderInlineRequest, renderSessionRequest } from '../request-card/inline';

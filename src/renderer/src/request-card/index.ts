// The request card's public surface (X4; C7 execution document, Repository map): the component every placement
// renders, the pure rules it applies, the transcript renderers, and `connectRequestCard`, which App.tsx's C7 block
// calls once to register the card in C5's `requestCard` slot and C6's request renderer.
import { registerSlot } from '../app/slots';
import { registerRequestRenderer } from '../transcript';
import { renderSessionRequest } from './inline';
import { RequestCard } from './RequestCard';

export { RequestCard, type Placement, type RequestCardProps } from './RequestCard';
export { scopeOptions, isDowngraded, type Scope, type ScopeOption } from './scope';
export { quickApproval, hoverApproval, type QuickApproval } from './quick-approval';
export { toAnswer, type VariantState } from './answers';
export { renderInlineRequest, renderSessionRequest, type RequestRenderer } from './inline';

// C5's slot (docked, card, hover) and C6's transcript slot (inline). The slot registration has no disposer in C5's
// registry; the returned function removes the transcript renderer.
export function connectRequestCard(): () => void {
  registerSlot('requestCard', RequestCard);
  return registerRequestRenderer(renderSessionRequest);
}

// UX wave U6b-5a (the branch panel's fix wave, G1): a draft port's answer for a load that could not read the store. The
// box restores nothing, as for no draft, but a draft may be kept there: an attach puts nothing in a box that has not read
// it, since the box's next save would write over it (`EditorHandle.attachPasted`, 'unread').
export const UNREAD = Symbol('the draft could not be read');
export type Unread = typeof UNREAD;

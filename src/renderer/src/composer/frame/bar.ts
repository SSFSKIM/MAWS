// UX wave U10b (O-43; its execution document §F.3, M7): the composer drawn as the float's bar, the box alone. The float's
// bar (`shell/FloatingPill.tsx`) mounts the session's compact pane inside this context; the composer reads it and passes
// `bar` to its frame, which hides the toolbar (mounted, as under a docked card) and gives the box the float's edge, and
// the menu chords ask for nothing there.
import { createContext } from 'react';

export const ComposerBarContext = createContext(false); // true inside the float's bar

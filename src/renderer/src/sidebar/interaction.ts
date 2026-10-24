import { createContext } from 'react';

// Portalled controls belong to the sidebar's interaction lifetime, even though their DOM lives elsewhere.
// Their ref disposal releases ownership when the browser emits no leave/blur for a removed element.
export const SidebarInteractionContext = createContext<((removed: Node) => void) | null>(null);

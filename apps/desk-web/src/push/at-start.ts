// What came of handing this device's subscription to the hub when the app started (`resyncPush`), kept for the
// Notifications panel: a refusal there is shown, not dropped.
import { create } from 'zustand';
import type { PushState } from './device';

export const usePushAtStart = create<{ state: PushState | null }>()(() => ({ state: null }));

// Right after the org key's first setup, the owner is prompted to add a second method: losing every method loses the key
// (the enrolled machines hold it, but nothing reads it back). The desk opens the key dialog while this is due.
import { create } from 'zustand';

export const useSecondMethodPrompt = create<{ due: boolean }>()(() => ({ due: false }));

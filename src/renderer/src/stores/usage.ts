// The account's usage windows (§5.5 status line fields `5h` and `7d`). C11 fills them; until then they stay null and
// the status line renders `—` placeholders.
import { create } from 'zustand';

export interface UsageWindow {
  percent: number;
  resetsAt: string;
}

export interface UsageState {
  windows: { fiveHour: UsageWindow; sevenDay: UsageWindow } | null;
  updatedAt: string | null;
  setWindows(windows: UsageState['windows'], at: string): void;
}

export const useUsage = create<UsageState>()((set) => ({
  windows: null,
  updatedAt: null,
  setWindows: (windows, at) => set({ windows, updatedAt: at }),
}));

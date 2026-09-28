// Banners (persistent, account- and app-wide, one host per window, §5.5) and toasts (transient). The hosts that render
// them are M5's; C11's near-limit banner and the notifier's fallback toast arrive through `banner()` and `toast()`.
import { create } from 'zustand';

export interface Notice {
  id: string;
  kind: 'banner' | 'toast';
  level: 'info' | 'warning' | 'danger';
  text: string;
  actions: { label: string; run: () => void }[];
  dismissible: boolean;
}

type NoticeInput = Omit<Notice, 'id' | 'kind'> & { id?: string };

export interface NoticesState {
  notices: Notice[];
  banner(notice: NoticeInput): string; // returns the id; an id already shown is replaced in place
  toast(notice: NoticeInput): string;
  dismiss(id: string): void;
}

export function createNoticesStore() {
  let next = 0;
  return create<NoticesState>()((set, get) => {
    const post = (kind: Notice['kind'], { id = `${kind}-${++next}`, ...rest }: NoticeInput) => {
      const notice: Notice = { ...rest, id, kind };
      const notices = get().notices;
      const at = notices.findIndex((n) => n.id === id);
      set({ notices: at === -1 ? [...notices, notice] : notices.map((n, i) => (i === at ? notice : n)) });
      return id;
    };
    return {
      notices: [],
      banner: (notice) => post('banner', notice),
      toast: (notice) => post('toast', notice),
      dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
    };
  });
}

export const useNotices = createNoticesStore();

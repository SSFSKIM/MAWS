// Transient notices (residue *Banner placement*): Radix toasts at the main region's bottom right, gone after six seconds
// (paused while hovered or while the window is in the background, Radix's rule). Acting on a toast dismisses it; the
// attention fallback toast (`attention/navigation.ts`) opens its session that way.
import { Toast } from 'radix-ui';
import { useShallow } from 'zustand/react/shallow';
import { useNotices } from '../stores/notices';
import { LEVEL_EDGE } from './BannerHost';

export const TOAST_DURATION_MS = 6000;

export function ToastHost() {
  const toasts = useNotices(useShallow((s) => s.notices.filter((n) => n.kind === 'toast')));
  const dismiss = (id: string) => useNotices.getState().dismiss(id);
  return (
    <Toast.Provider duration={TOAST_DURATION_MS} swipeDirection="right">
      {toasts.map((notice) => (
        <Toast.Root
          key={notice.id}
          open
          onOpenChange={(open) => !open && dismiss(notice.id)}
          className={`flex w-80 items-start gap-2 rounded-md border border-l-2 border-border-strong bg-bg-overlay px-3 py-2 text-ui text-fg ${LEVEL_EDGE[notice.level]}`}
        >
          <Toast.Description className="min-w-0 flex-1">{notice.text}</Toast.Description>
          {notice.actions.map((action) => (
            <Toast.Action
              key={action.label}
              altText={action.label}
              onClick={action.run}
              className="shrink-0 rounded-sm px-2 py-0.5 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2"
            >
              {action.label}
            </Toast.Action>
          ))}
          {notice.dismissible && (
            <Toast.Close
              aria-label="Dismiss"
              className="shrink-0 rounded-sm px-1.5 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
            >
              <span aria-hidden>×</span>
            </Toast.Close>
          )}
        </Toast.Root>
      ))}
      <Toast.Viewport label="Notifications ({hotkey})" className="absolute right-3 bottom-3 z-40 flex flex-col gap-2 outline-none" />
    </Toast.Provider>
  );
}

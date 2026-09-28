// The banner host (charter §5.5; residue *Banner placement*): the one place in the window for account- and app-wide
// banners (C11's near-limit banner, once per window, never above every composer). It spans the main region between the
// tab strips and the panes; banners stack newest last, each with its actions and, when dismissible, a dismiss control.
import { useShallow } from 'zustand/react/shallow';
import { useNotices, type Notice } from '../stores/notices';

export const LEVEL_EDGE: Record<Notice['level'], string> = { info: 'border-l-info', warning: 'border-l-warning', danger: 'border-l-danger' };

export function BannerHost({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  const banners = useNotices(useShallow((s) => s.notices.filter((n) => n.kind === 'banner')));
  return (
    <div data-banner-host className={`flex flex-col ${className}`} style={style}>
      {banners.map((notice) => (
        <div
          key={notice.id}
          role="status"
          className={`flex min-h-9 items-center gap-3 border-b border-l-2 border-b-border bg-bg-raised px-3 py-1.5 text-ui text-fg ${LEVEL_EDGE[notice.level]}`}
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          {notice.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.run}
              className="shrink-0 rounded-sm px-2 py-0.5 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2"
            >
              {action.label}
            </button>
          ))}
          {notice.dismissible && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => useNotices.getState().dismiss(notice.id)}
              className="shrink-0 rounded-sm px-1.5 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
            >
              <span aria-hidden>×</span>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

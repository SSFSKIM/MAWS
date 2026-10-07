// E4a: the pane of a tab another pane owns (Design §3; Decision Log 22): a page's view lives in one pane at a time, so
// this one says where it went and offers it back.
import { BROWSER_COPY } from '../copy';
import { PAGE_BUTTON } from './PageFrame';

export function ShownElsewhere({ onShowHere }: { onShowHere(): void }) {
  return (
    <div data-browser-page="elsewhere" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      <p className="m-0 text-ui text-fg-muted">{BROWSER_COPY.shownElsewhere}</p>
      <button type="button" className={PAGE_BUTTON} onClick={onShowHere}>
        {BROWSER_COPY.showHere}
      </button>
    </div>
  );
}

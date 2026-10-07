// E4a: a page that failed to load (Design §5; Decision Log 3): Codex's error page drawn as DOM in the pane while main
// hides the view: the heading, the summary for the kind with the host, "Try:" over two suggestions whose second opens
// the details (every kind but a certificate's), the error's name, and Reload, which loads the failed URL again (main
// turns `reload` into `loadURL(loadError.url)`, since the committed entry is Chromium's own error page).
import { useId, useState } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import { navigate } from '../actions';
import { BROWSER_COPY } from '../copy';
import { PAGE_BUTTON, PageFrame } from './PageFrame';

type LoadError = NonNullable<BrowserTab['loadError']>;

export function ErrorPage({ tabId, loadError }: { tabId: string; loadError: LoadError }) {
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const copy = BROWSER_COPY.loadError;
  const host = loadError.host || loadError.url;
  return (
    <PageFrame page={`error-${loadError.kind}`} heading={copy.heading} summary={copy.summary[loadError.kind](host)}>
      {loadError.kind !== 'certificate' && (
        <div>
          <p className="m-0">{copy.try}</p>
          <ul className="m-0 list-disc pl-5">
            <li>{copy.checkConnection}</li>
            <li>
              <button
                type="button"
                aria-expanded={details}
                aria-controls={detailsId}
                onClick={() => setDetails((open) => !open)}
                className="text-left text-fg-muted underline-offset-2 outline-accent hover:text-fg hover:underline focus-visible:outline-2"
              >
                {copy.checkProxy}
              </button>
            </li>
          </ul>
        </div>
      )}
      <p className="m-0 font-mono text-ui-sm text-fg-faint uppercase">{copy.code(loadError.code, loadError.description)}</p>
      <div className="mt-3">
        <button type="button" className={PAGE_BUTTON} onClick={() => navigate(tabId, 'reload')}>
          {BROWSER_COPY.reload}
        </button>
      </div>
      {details && (
        <div id={detailsId} className="mt-3 flex flex-col gap-3">
          {copy.details.map(({ header, body }) => (
            <div key={header}>
              <p className="m-0 font-medium text-fg">{header}</p>
              <p className="m-0 text-fg-muted">{body}</p>
            </div>
          ))}
        </div>
      )}
    </PageFrame>
  );
}

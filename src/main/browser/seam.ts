// The browser's e2e seam (E4a execution document, Interfaces "Events"; E2's pattern, `deliverables/policies.ts`): under
// MAWS_E2E=1 with MAWS_E2E_OPEN_LOG set, main appends one line per guarded act to that log (`browser-blocked-navigation
// <url>`, `browser-blocked-popup <url>`), and what would leave the app (a `mailto:` link, a link opened in the system
// browser, Reveal in Finder) is written there instead of done, as the files service does (`openExternal <url>`, `reveal
// <path>`), so an e2e run launches nothing. Outside the e2e every line is dropped and the acts are real.
import { appendFile } from 'node:fs/promises';
import { shell } from 'electron';
import { openExternalUrl } from '../open-external';

export interface BrowserSeam {
  readonly active: boolean;
  line(text: string): void;
  openExternal(url: string): void; // http, https and mailto only (`openExternalUrl`)
  reveal(path: string): void;
}

export function browserSeam(env: NodeJS.ProcessEnv): BrowserSeam {
  const path = env.MAWS_E2E === '1' ? env.MAWS_E2E_OPEN_LOG : undefined;
  let writes: Promise<void> = Promise.resolve(); // one append at a time, so the log keeps the order of the acts
  const line = (text: string) => {
    if (!path) return;
    writes = writes.then(() => appendFile(path, `${text}\n`)).catch((error: unknown) => console.warn('[browser] could not write the e2e seam log', error));
  };
  return {
    active: path !== undefined,
    line,
    openExternal: (url) => (path ? line(`openExternal ${url}`) : void openExternalUrl(url)),
    reveal: (file) => (path ? line(`reveal ${file}`) : shell.showItemInFolder(file)),
  };
}

// The agent's downloads (the in-app browser spec of 2026-10-08, "Downloads"): a `will-download` whose page is a tab under
// a cua lease is the agent's while the person does not hold the tab (control `agent`, or `idle` with control's
// `personHolds` false: the rule dialogs and navigations follow, so a person who took the tab over gets the save dialog
// and no agent row or deliverable). E4a's Downloads saves it without a dialog in ~/Downloads (its own module keeps the line
// and Reveal in Finder as for a person's download) and reports it here; this tells the leasing connection's host
// `downloads.created` and `downloads.changed` in Chrome's shape (the host maps them to the vendor's onDownloadChange,
// whose `started` is matched by the URL the vendor approved and whose last filename is what `download.path()` answers),
// tells the windows the download's end, and has a completed file recorded as a File artifact of the session that drove it (P3-L M6b).
// A cancelled or failed download is never recorded.
import { basename } from 'node:path';
import type { MawsDownloadRecorded } from '@shared/ipc/schema/maws';
import { personHolds } from '../agent/control';
import type { TabEntry } from '../tabs';
import type { TabClaims } from './claims';
import type { CuaConnection } from './connection';

export interface AgentDownload {
  url: string; // the first URL of the download's chain
  finalUrl: string; // the URL it ended at (the response the vendor approved)
  path: string; // where it is being saved
}

export interface AgentDownloadEnd {
  state: 'completed' | 'cancelled' | 'interrupted'; // Electron's DownloadItem states
  path: string; // where it was saved (the item's save path)
  bytes: number;
}

export interface AgentDownloads {
  // The tab is under a cua lease and the person does not hold it: a download from its page is the agent's.
  owns(entry: TabEntry): boolean;
  // The agent's download began; the answer is told its end.
  started(entry: TabEntry, download: AgentDownload): (end: AgentDownloadEnd) => void;
}

export interface AgentDownloadsDeps {
  claims: Pick<TabClaims<CuaConnection>, 'leasedTo'>;
  recordDownload?(download: MawsDownloadRecorded): Promise<unknown>;
  log(line: string): void;
}

// Chrome's interrupt reason for a cancel (the host maps it to `canceled`); any other end is a failure to the host.
const CANCELED = 'USER_CANCELED';
const FAILED = 'NETWORK_FAILED';

export function agentDownloads({ claims, recordDownload, log }: AgentDownloadsDeps): AgentDownloads {
  let nextId = 1;
  return {
    owns: (entry) => {
      const { control } = entry.tab;
      return claims.leasedTo(entry.tab.tabId) !== undefined && (control === 'agent' || (control === 'idle' && !personHolds(entry, Date.now())));
    },
    started(entry, { url, finalUrl, path }) {
      const connection = claims.leasedTo(entry.tab.tabId);
      const id = nextId++;
      connection?.downloadCreated({ id, url, finalUrl, filename: path });
      return ({ state, path: saved, bytes }) => {
        const filename = basename(saved || path);
        if (state === 'completed') connection?.downloadChanged({ id, filename: saved, state: 'complete' });
        else connection?.downloadChanged({ id, filename: saved || path, state: 'interrupted', error: state === 'cancelled' ? CANCELED : FAILED });
        if (!connection) return;
        connection.tell(entry, { kind: 'download', filename, state: state === 'completed' ? 'complete' : state });
        if (state !== 'completed' || !recordDownload) return;
        recordDownload({ appSessionId: connection.appSessionId, tabId: entry.tab.tabId, path: saved, filename, url: finalUrl, bytes }).catch((error: unknown) =>
          log(`could not record tab ${entry.tab.tabId}'s download as a File artifact of ${connection.appSessionId}: ${(error as Error).message}`),
        );
      };
    },
  };
}

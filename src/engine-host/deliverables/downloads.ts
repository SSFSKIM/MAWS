// An agent's finished download as a session deliverable (the in-app browser spec of 2026-10-08 in the cua repository,
// "Downloads"; `maws.download.recorded`): main saw a file an agent downloaded through cua complete in ~/Downloads and asks
// the session's engine host to record it. One `kind: 'file'` record per path, the file referenced in place (A-3), titled
// with its name, with the URL it came from in X12's additive `sourceUrl` when that is an http(s) URL of sane length. The
// check and the write run in the session's write chain, so two reports of one path (a retry, two windows) record it once.
import { randomUUID } from 'node:crypto';
import type { MawsDownloadRecorded } from '@shared/ipc/schema/maws';
import type { DeliverableWriter } from './store';

const SOURCE_URL_MAX_CHARS = 2048;

export async function recordDownload(
  writer: DeliverableWriter,
  download: MawsDownloadRecorded,
  opts: { now?: () => string; id?: () => string } = {},
): Promise<'recorded' | 'duplicate'> {
  const now = opts.now ?? (() => new Date().toISOString());
  const { appSessionId, path, filename, url } = download;
  return writer.exclusive(appSessionId, async () => {
    if ((await writer.list(appSessionId)).some((record) => record.kind === 'file' && record.path === path)) return 'duplicate';
    const at = now();
    await writer.write({
      id: (opts.id ?? randomUUID)(),
      appSessionId,
      kind: 'file',
      path,
      title: filename,
      versions: [{ path, at }],
      createdAt: at,
      ...(sourceUrl(url) && { sourceUrl: url }),
    });
    return 'recorded';
  });
}

function sourceUrl(url: string): boolean {
  if (url.length > SOURCE_URL_MAX_CHARS || /\s/.test(url) || !URL.canParse(url)) return false;
  const { protocol } = new URL(url);
  return protocol === 'http:' || protocol === 'https:';
}

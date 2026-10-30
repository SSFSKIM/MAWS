// The upload strip (P5 O9 M7, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M7): above a lane A composer, the images
// and PDFs a send handed to the session's bridge, each with its state as the bridge says it (src/renderer/src/lane-a/
// uploads.ts follows them): waiting for the turn, being read, read, sent on to the model, or not read with the bridge's
// reason. An upload whose every file went on leaves by itself; one with a file that did not stays until dismissed.
import type { AppSessionId } from '@shared/graph/ids';
import { dismissUpload, useLaneA, type LaneAUpload } from '../stores/lane-a';

export const UPLOAD_WORDS = {
  label: 'Images and PDFs sent to the terminal session',
  state: (state: string, reason: string | null): string => {
    const said = STATES[state] ?? state;
    return reason !== null && (state === 'failed' || state === 'aborted') ? `${said}: ${reason}` : said;
  },
  dismiss: 'Dismiss',
};

const STATES: Record<string, string> = {
  queued: 'Waiting for the turn',
  pending: 'Waiting for the turn',
  claimed: 'Being read',
  read: 'Read',
  forwarded: 'Sent to the model',
  aborted: 'Not read',
  failed: 'Not read',
};

const NONE: readonly LaneAUpload[] = [];

export function PendingUploads({ appSessionId }: { appSessionId: AppSessionId }) {
  const uploads = useLaneA((s) => s.uploads.get(appSessionId) ?? NONE);
  if (uploads.length === 0) return null;
  return (
    <ul aria-label={UPLOAD_WORDS.label} className="m-0 flex list-none flex-col gap-1 p-0">
      {uploads.map((upload) => (
        <li key={upload.upload} data-upload={upload.upload} className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-ui-sm">
          <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-0.5 p-0">
            {upload.files.map((file, index) => (
              <li key={index} data-upload-state={file.state} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate text-fg" title={file.name}>
                  {file.name}
                </span>
                <span className={`min-w-0 truncate ${file.state === 'failed' || file.state === 'aborted' ? 'text-danger' : 'text-fg-muted'}`} title={file.reason ?? undefined}>
                  {UPLOAD_WORDS.state(file.state, file.reason)}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="shrink-0 rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
            onClick={() => dismissUpload(appSessionId, upload.upload)}
          >
            {UPLOAD_WORDS.dismiss}
          </button>
        </li>
      ))}
    </ul>
  );
}

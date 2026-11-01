// The attachment strip (C7 execution document, "Composer frame"): inside the frame directly above the box, one tile per
// image (a thumbnail) or PDF, each removable, and "not kept in draft" on those the draft's byte budget left out.
// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Uploads in parts"): a file bound for a lane B
// session on another machine shows its extension, and while its send's uploads run, each tile going up says how far its
// parts have gone (or that it waits its turn), as main says them (`remote.upload`).
import type { Attachment } from '../editor/doc';
import { useUploadProgress } from '../editor/remote-uploads';

// What the tile's square says of a file that has no thumbnail.
function kindLabel(a: Attachment): string {
  if (a.kind === 'document') return 'PDF';
  const dot = a.name.lastIndexOf('.');
  const extension = dot > 0 ? a.name.slice(dot + 1) : '';
  return extension !== '' && extension.length <= 4 ? extension.toUpperCase() : 'FILE';
}

export const UPLOAD_WORDS = {
  waiting: 'Waiting to upload',
  parts: (sent: number, parts: number) => `Uploading ${sent} of ${parts}`,
} as const;

function UploadMark({ attachment }: { attachment: Attachment }) {
  const progress = useUploadProgress(attachment.id);
  if (progress === undefined) return null;
  return (
    <span role="status" aria-label={`${attachment.name} upload`} className="text-fg-muted">
      {progress === null ? UPLOAD_WORDS.waiting : UPLOAD_WORDS.parts(progress.sent, progress.parts)}
    </span>
  );
}

export function AttachmentStrip({ attachments, onRemove }: { attachments: readonly Attachment[]; onRemove(id: string): void }) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="attachments" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {attachments.map((a) => (
        <li key={a.id} className="flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-bg-raised py-1 pr-1 pl-1 text-ui-sm text-fg-muted">
          {a.kind === 'image' ? (
            <img alt="" src={`data:${a.mediaType};base64,${a.data}`} className="size-8 shrink-0 rounded-sm object-cover" />
          ) : (
            <span aria-hidden data-attachment-kind className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-bg-hover text-ui-sm">
              {kindLabel(a)}
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-fg">{a.name}</span>
            {!a.persisted && <span className="text-fg-faint">not kept in draft</span>}
            <UploadMark attachment={a} />
          </span>
          <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)} className="rounded-sm px-1 text-fg-faint outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

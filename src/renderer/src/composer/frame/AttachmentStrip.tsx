// The attachment strip (C7 execution document, "Composer frame"): inside the frame directly above the box, one tile per
// image (a thumbnail) or PDF, each removable, and "not kept in draft" on those the draft's byte budget left out.
import type { Attachment } from '../editor/doc';

export function AttachmentStrip({ attachments, onRemove }: { attachments: readonly Attachment[]; onRemove(id: string): void }) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="attachments" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {attachments.map((a) => (
        <li key={a.id} className="flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-bg-raised py-1 pr-1 pl-1 text-ui-sm text-fg-muted">
          {a.kind === 'image' ? (
            <img alt="" src={`data:${a.mediaType};base64,${a.data}`} className="size-8 shrink-0 rounded-sm object-cover" />
          ) : (
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-bg-hover text-ui-sm">
              PDF
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-fg">{a.name}</span>
            {!a.persisted && <span className="text-fg-faint">not kept in draft</span>}
          </span>
          <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)} className="rounded-sm px-1 text-fg-faint outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

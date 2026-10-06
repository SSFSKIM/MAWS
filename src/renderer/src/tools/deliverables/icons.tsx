// E2 (M4): the Deliverables tool's glyphs: the tool's own (a tray), and a row's kind (an artifact's frame, a file by its
// mime family, a screenshot's camera). Strokes on `currentColor`, so a row's text colour is the glyph's.
import { mimeOf } from '@shared/files/mime';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { Icon } from '../../app/IconButton';
import { basename } from './model';

export function DeliverablesIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" />
      <path d="M2.5 9.5 4 3.5h8l1.5 6v3h-11z" />
    </Icon>
  );
}

const ArtifactGlyph = () => (
  <Icon>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 5.5h12M6.5 8l-1.5 1.5L6.5 11M9.5 8l1.5 1.5L9.5 11" />
  </Icon>
);

const ScreenshotGlyph = () => (
  <Icon>
    <path d="M2 5.5h2.5l1-1.5h5l1 1.5H14v7H2z" />
    <circle cx="8" cy="9" r="2" />
  </Icon>
);

const ImageGlyph = () => (
  <Icon>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <circle cx="6" cy="6.5" r="1" />
    <path d="M2.5 12 6.5 8.5l3 2.5 2-1.5 2.5 2" />
  </Icon>
);

const MediaGlyph = () => (
  <Icon>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6.5 6v4l3.5-2z" />
  </Icon>
);

const FileGlyph = () => (
  <Icon>
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
  </Icon>
);

export function KindGlyph({ record }: { record: DeliverableRecord }) {
  if (record.kind === 'artifact') return <ArtifactGlyph />;
  if (record.kind === 'screenshot') return <ScreenshotGlyph />;
  const mime = mimeOf(basename(record.path));
  if (mime.startsWith('image/')) return <ImageGlyph />;
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return <MediaGlyph />;
  return <FileGlyph />;
}

// An image result: the images inline from their data URLs (the renderer loads nothing by path) and the source's name.
import type { CellDetail } from '../../model/rows';

type Image = Extract<CellDetail, { kind: 'image' }>;

export function ImageDetail({ detail }: { detail: Image }) {
  return (
    <div className="transcript-image-detail">
      {detail.images.map((image, i) => (
        <img key={i} className="transcript-detail-image" src={image.dataUrl} alt={image.alt ?? detail.caption ?? ''} />
      ))}
      {detail.caption && <div className="transcript-detail-note transcript-mono">{detail.caption}</div>}
    </div>
  );
}

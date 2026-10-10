// An image inline (C8c execution document, Interfaces *Viewer kinds and caps*): an <img> from a `data:` URL (the CSP's
// `img-src` admits `data:`; nothing is loaded by path). An svg in an <img> is inert: no script runs in an image document.
//
// P2-F W-V (L95, §2 item 6): the image fits the pane by default, grown or shrunk with its aspect kept; the zoom the file
// body holds (its bar draws the controls) sizes it otherwise, and a click on the image toggles actual size and fit.
import { basename } from '../files/tree';
import { dataUrl } from './kinds';
import { ZoomStage, zoomedMedia, type MediaZoom } from './MediaZoom';
import type { ViewerEntry } from './viewer-store';

export function ImageView({ entry, zoom }: { entry: ViewerEntry; zoom: MediaZoom }) {
  const src = dataUrl(entry.mime, entry.encoding, entry.encoding === 'base64' ? (entry.base64 ?? '') : entry.text);
  const { className, style } = zoomedMedia(zoom);
  // the cursor says which way a click goes: to actual size from fit, to fit from any zoom
  const target = zoom.zoom === 'fit' ? 1 : zoom.fit;
  const grows = zoom.scale !== null && target !== null && target > zoom.scale;
  return (
    <div data-image-view className="h-full min-h-0">
      <ZoomStage zoom={zoom} className="h-full">
        <img
          src={src}
          alt={basename(entry.path)}
          onLoad={(event) => zoom.setMedia({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onClick={() => zoom.set(zoom.zoom === 'fit' ? 1 : 'fit')}
          style={style}
          className={`${className} ${grows ? 'cursor-zoom-in' : 'cursor-zoom-out'}`}
        />
      </ZoomStage>
    </div>
  );
}

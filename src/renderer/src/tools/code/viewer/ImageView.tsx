// An image inline (C8c execution document, Interfaces *Viewer kinds and caps*): an <img> from a `data:` URL (the CSP's
// `img-src` admits `data:`; nothing is loaded by path), fit to the pane's width, a click toggling its natural size. An
// svg in an <img> is inert: no script runs in an image document.
import { useState } from 'react';
import { basename } from '../files/tree';
import { dataUrl } from './kinds';
import type { ViewerEntry } from './viewer-store';

export function ImageView({ entry }: { entry: ViewerEntry }) {
  const [natural, setNatural] = useState(false);
  const src = dataUrl(entry.mime, entry.encoding, entry.encoding === 'base64' ? (entry.base64 ?? '') : entry.text);
  return (
    <div data-image-view className="flex h-full min-h-0 items-start justify-center overflow-auto p-4">
      <img
        src={src}
        alt={basename(entry.path)}
        onClick={() => setNatural((was) => !was)}
        className={natural ? 'max-w-none cursor-zoom-out' : 'max-w-full cursor-zoom-in'}
      />
    </div>
  );
}

// The `img` of every markdown surface: the gates leave only inline `data:image/` sources (every other markdown image
// became a chip in the remark stage), so this renders them and nothing else.
import type { ComponentProps } from 'react';
import type { ExtraProps } from 'streamdown';

export function TranscriptImage({ src, alt }: ComponentProps<'img'> & ExtraProps) {
  if (typeof src !== 'string' || !/^data:image\//i.test(src)) return null;
  return <img className="transcript-image" src={src} alt={alt ?? ''} />;
}

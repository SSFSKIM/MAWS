// E2 (M4): a video or audio deliverable in the native element (Design §3 "Media"), streamed from the scheme, whose
// handler answers `Range` requests, so seeking works; only the metadata loads until the owner plays it.
//
// P2-F W-V (L95, §2 item 6): a video fits the pane by default, grown or shrunk with its aspect kept, and its bar (the
// file viewer's, so an image and a video size alike) zooms it in and out, to actual size and back to fit. A click on the
// video stays the player's own.
//
// P3-L (M5b): shared with the artifact store's File viewer (`owner` names the element's data attribute; `onLoad`: its
// metadata loaded, the player is on screen).
import { useMediaZoom, ZoomControls, ZoomStage, zoomedMedia } from '../../../code/viewer/MediaZoom';
import type { FrameOwner } from './HtmlFrame';

interface Props {
  kind: 'video' | 'audio';
  url: string;
  owner?: FrameOwner;
  onLoad?(): void;
}

export function Media({ kind, url, owner = 'deliverable', onLoad }: Props) {
  if (kind === 'video') return <Video url={url} owner={owner} onLoad={onLoad} />;
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <audio {...{ [`data-${owner}-media`]: 'audio' }} controls preload="metadata" src={url} onLoadedMetadata={onLoad} className="w-full max-w-md" />
    </div>
  );
}

function Video({ url, owner, onLoad }: Omit<Props, 'kind'> & { owner: FrameOwner }) {
  const zoom = useMediaZoom(url);
  const { className, style } = zoomedMedia(zoom);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border px-3 py-1 text-ui-sm">
        <ZoomControls zoom={zoom} />
      </div>
      <ZoomStage zoom={zoom} className="flex-1">
        <video
          {...{ [`data-${owner}-media`]: 'video' }}
          controls
          preload="metadata"
          src={url}
          onLoadedMetadata={(event) => {
            zoom.setMedia({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight });
            onLoad?.();
          }}
          style={style}
          className={className}
        />
      </ZoomStage>
    </div>
  );
}

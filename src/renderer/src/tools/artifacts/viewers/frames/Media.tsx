// E2 (M4): a video or audio file in the native element (Design §3 "Media"), streamed from the scheme, whose
// handler answers `Range` requests, so seeking works; only the metadata loads until the owner plays it.
//
// P2-F W-V (L95, §2 item 6): a video fits the pane by default, grown or shrunk with its aspect kept, and its bar (the
// file viewer's, so an image and a video size alike) zooms it in and out, to actual size and back to fit. A click on the
// video stays the player's own.
//
// P3-L (M5b): the artifact store's File viewer's (`onLoad`: its metadata loaded, the player is on screen).
//
// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5, decisions 6 and 13): a file's video or
// sound is drawn here too. `startAt` is set once its metadata has loaded, paused (nothing here ever plays), `onTime`
// reports the position as it plays, and `onError` the element's error; each does nothing when absent. A sound's player
// takes little horizontal padding, so its timeline stays at the side column's least width (L10); the player's own width
// is bounded, so a wide pane shows no difference.
import { useRef } from 'react';
import { useMediaZoom, ZoomControls, ZoomStage, zoomedMedia } from '../../../code/viewer/MediaZoom';

interface Props {
  kind: 'video' | 'audio';
  url: string;
  onLoad?(): void;
  onError?(): void; // UX wave U6b-2
  startAt?: number; // UX wave U6b-2: seconds, set once the metadata has loaded
  onTime?(seconds: number): void; // UX wave U6b-2
}

// UX wave U6b-2: what the element tells its owner beyond `onLoad`: the start time set once, the position, an error.
function useMediaEvents({ onLoad, onError, startAt, onTime }: Omit<Props, 'kind' | 'url'>) {
  const started = useRef(false);
  return {
    loaded: (element: HTMLMediaElement) => {
      if (startAt !== undefined && !started.current) element.currentTime = startAt;
      started.current = true;
      onLoad?.();
    },
    onTimeUpdate: onTime && ((event: { currentTarget: HTMLMediaElement }) => onTime(event.currentTarget.currentTime)),
    onError: onError && (() => onError()),
  };
}

export function Media({ kind, url, ...rest }: Props) {
  const events = useMediaEvents(rest);
  if (kind === 'video') return <Video url={url} events={events} />;
  return (
    <div className="flex h-full items-center justify-center bg-bg px-2 py-6">
      <audio
        data-artifact-media="audio"
        controls
        preload="metadata"
        src={url}
        onLoadedMetadata={(event) => events.loaded(event.currentTarget)}
        onTimeUpdate={events.onTimeUpdate}
        onError={events.onError}
        className="w-full max-w-md"
      />
    </div>
  );
}

function Video({ url, events }: { url: string; events: ReturnType<typeof useMediaEvents> }) {
  const zoom = useMediaZoom(url);
  const { className, style } = zoomedMedia(zoom);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border px-3 py-1 text-ui-sm">
        <ZoomControls zoom={zoom} />
      </div>
      <ZoomStage zoom={zoom} className="flex-1">
        <video
          data-artifact-media="video"
          controls
          preload="metadata"
          src={url}
          onLoadedMetadata={(event) => {
            zoom.setMedia({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight });
            events.loaded(event.currentTarget);
          }}
          onTimeUpdate={events.onTimeUpdate}
          onError={events.onError}
          style={style}
          className={className}
        />
      </ZoomStage>
    </div>
  );
}

// E2 (M4): a video or audio deliverable in the native element (Design §3 "Media"), streamed from the scheme, whose
// handler answers `Range` requests, so seeking works; only the metadata loads until the owner plays it.
export function Media({ kind, url }: { kind: 'video' | 'audio'; url: string }) {
  if (kind === 'video') {
    return (
      <div className="flex h-full items-center justify-center bg-bg p-3">
        <video data-deliverable-media="video" controls preload="metadata" src={url} className="max-h-full max-w-full" />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <audio data-deliverable-media="audio" controls preload="metadata" src={url} className="w-full max-w-md" />
    </div>
  );
}

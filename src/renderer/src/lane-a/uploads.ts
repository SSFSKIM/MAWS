// A lane A upload followed (P5 O9 M7, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M7): `laneA.media` answers once
// the bridge holds the upload, and each file's state comes later as the session's `media` op messages for the upload's id
// (DX4 `MediaOpBody`: `read` when its Read holds the image or document, `forwarded` once the next request carried it on,
// `aborted` or `failed` with a reason), which the page's watch carries. Each message names the whole upload as it stands,
// so the latest one is the picture. The lane A store keeps it for the composer's strip; an upload whose every file went
// on leaves after UPLOAD_LINGER_MS, one with a file that did not stays until the person dismisses it. Bounded: an upload
// no message ends is let go of after UPLOAD_FOLLOW_MS, its strip entry left as the bridge last said it.
import type { MediaOpBody, SessionMessage } from 'desk-hub/protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { dismissUpload, holdUpload, noteUploadStates } from '../stores/lane-a';
import { opMessagesOf, watchLaneA } from './watches';

export const UPLOAD_LINGER_MS = 4000;
// A busy turn reads the files at its next main-loop step, which a long tool call can put minutes away.
export const UPLOAD_FOLLOW_MS = 10 * 60_000;

const follows = new Set<() => void>();

const isMedia = (message: SessionMessage, upload: string): message is SessionMessage & { body: MediaOpBody } =>
  message.kind === 'op' && (message.body as { op?: unknown; id?: unknown }).op === 'media' && (message.body as { id?: unknown }).id === upload;

// Holds the upload in the store under the files' names and follows its states until it ends.
export function followUpload(appSessionId: AppSessionId, upload: string, names: readonly string[], client: MawsBridge): void {
  holdUpload(appSessionId, upload, names);
  let off: () => void = () => {};
  let linger: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    clearTimeout(bound);
    off();
    follows.delete(stop);
  };
  const apply = (messages: readonly SessionMessage[]) => {
    for (const message of messages) {
      if (!isMedia(message, upload)) continue;
      const now = noteUploadStates(appSessionId, upload, Array.isArray(message.body.attachments) ? message.body.attachments : []);
      if (now === null || message.body.phase !== 'end') continue;
      stop();
      if (linger === null && now.files.every((f) => f.state === 'forwarded')) linger = setTimeout(() => dismissUpload(appSessionId, upload), UPLOAD_LINGER_MS);
    }
  };
  const bound = setTimeout(stop, UPLOAD_FOLLOW_MS);
  follows.add(stop);
  apply(opMessagesOf(appSessionId, upload)); // what the page heard while `laneA.media` was answering
  if (!follows.has(stop)) return; // it had ended already
  off = watchLaneA(appSessionId, (event) => event.kind === 'messages' && apply(event.messages), { client });
}

// Tests: every follow let go.
export function resetUploadFollows(): void {
  for (const stop of [...follows]) stop();
}

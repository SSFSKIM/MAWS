// The app's `SheetHost` (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H; the composite's X5): what
// the sheet's components are given in a MAWS window. A Send goes to this machine's sheet service as `sheet.put` (main's
// router, then `mawsd`, then `sminos sheet put`), a body as `sheet.body`, a pasted image is downscaled as the composer's
// are and saved under the record's `uploads/` (`sheet.upload`), a link opens as the transcript's open, and a reference's
// file opens beside the chat in the session's own folder. `appSessionId` is the session the sheet is of: a file opens
// on its machine and a loopback link in its in-app browser.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { SheetImageType, SheetPutResult } from '@shared/sheet/model';
import { downscaleImage } from '../../composer/editor/attachments';
import { ipc } from '../../ipc/client';
import type { SheetHost } from '../../sheet';
import { openFile } from '../code/open-file';
import { registeredActions } from '../../transcript/view/registry';

const failed = (message: string): SheetPutResult => ({ ok: false, why: 'failed', message });

export function appSheetHost(appSessionId: AppSessionId | null, client: MawsBridge = ipc): SheetHost {
  return {
    by: 'maws',
    newKey: () => `maws-${crypto.randomUUID()}`,
    // A call the wire could not carry is `failed`: nobody knows whether its lines were appended, so the sheet offers the
    // same lines again, under the same keys (§E).
    send: async (session, lines) => {
      const result = await client.invoke('sheet.put', { session, lines }).catch((error: unknown) => ({ ok: false as const, error: { message: error instanceof Error ? error.message : String(error) } }));
      return result.ok ? result.value : failed(result.error.message);
    },
    openLink: (url) => registeredActions().openExternal(url, appSessionId),
    body: async (session, of) => {
      const result = await client.invoke('sheet.body', { session, of }).catch(() => null);
      return result?.ok ? result.value : { kind: 'gone' };
    },
    saveImage: async (session, image) => {
      try {
        const scaled = await downscaleImage(new Blob([image.bytes as BlobPart], { type: image.mediaType }), image.mediaType);
        const result = await client.invoke('sheet.upload', { session, mediaType: scaled.mediaType as SheetImageType, data: scaled.data });
        return result.ok ? result.value : { ok: false, why: result.error.message };
      } catch (error) {
        return { ok: false, why: error instanceof Error ? error.message : String(error) };
      }
    },
    openFile: (abs, line) => void openFile(appSessionId, abs, line),
  };
}

// What a surface gives the sheet's components (the composite's X5; the C3 plan's §G): how to send inbox lines, open a
// link, fetch a body, and, where the surface can, save a pasted image and open a referenced file. The app's host is
// R/tools/sheet's; C4's page and desk-web bring their own.
import type { SheetBodyRequest, SheetBody, SheetImageType, SheetLine, SheetPutResult } from '@shared/sheet/model';

export interface SheetHost {
  by: 'maws' | 'page' | 'desk';
  newKey(): string; // one per act, of [A-Za-z0-9._:-], 8 to 128
  send(session: string, lines: SheetLine[]): Promise<SheetPutResult>;
  openLink(url: string): void; // an http or https link of agent-written Markdown; no other link reaches a host
  body(session: string, of: SheetBodyRequest): Promise<SheetBody>;
  // absent: pasting is not offered (the phone). The host downscales.
  saveImage?: (session: string, image: { mediaType: SheetImageType; bytes: Uint8Array }) => Promise<{ ok: true; path: string } | { ok: false; why: string }>;
  openFile?: (abs: string, line: number | null) => void; // a reference's file as it is now; absent: no such control
}

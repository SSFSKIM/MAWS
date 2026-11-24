// A host for the sheet's components that records what it is asked (the C3 plan's M3): the sheet's suites, the harness's
// `#sheet` page and desk-web's suite draw the components over it. Each answer can be replaced: a test makes a Send fail,
// or never answer, or a body arrive late.
import type { SheetBody, SheetBodyRequest, SheetLine, SheetPutResult } from '@shared/sheet/model';
import type { SheetHost } from '../host';

export interface RecordingHost extends SheetHost {
  readonly sent: { session: string; lines: SheetLine[] }[];
  readonly links: string[];
  readonly files: { abs: string; line: number | null }[];
  readonly bodies: SheetBodyRequest[];
  readonly images: { session: string; mediaType: string; bytes: Uint8Array }[];
}

export interface FixtureHostOptions {
  by?: SheetHost['by'];
  send?: (session: string, lines: SheetLine[]) => Promise<SheetPutResult>;
  body?: (session: string, of: SheetBodyRequest) => Promise<SheetBody>;
  saveImage?: boolean; // offer pasting; each saved image answers `uploads/maws-fixture-<n>.png`
  openFile?: boolean;
}

/** Every line queued, as the door answers a stopped session's Send. */
export const queuedResult = (lines: readonly SheetLine[]): SheetPutResult => ({ ok: true, results: lines.map((line) => ({ key: line.key, state: 'queued' as const })) });

export function fixtureHost(options: FixtureHostOptions = {}): RecordingHost {
  const sent: RecordingHost['sent'] = [];
  const links: string[] = [];
  const files: RecordingHost['files'] = [];
  const bodies: SheetBodyRequest[] = [];
  const images: RecordingHost['images'] = [];
  let keys = 0;
  const host: RecordingHost = {
    by: options.by ?? 'maws',
    sent,
    links,
    files,
    bodies,
    images,
    newKey: () => `maws-fixture-${String((keys += 1)).padStart(4, '0')}`,
    send: (session, lines) => {
      sent.push({ session, lines });
      return options.send ? options.send(session, lines) : Promise.resolve(queuedResult(lines));
    },
    openLink: (url) => void links.push(url),
    body: (session, of) => {
      bodies.push(of);
      return options.body ? options.body(session, of) : Promise.resolve({ kind: 'gone' });
    },
  };
  if (options.saveImage) {
    host.saveImage = (session, image) => {
      images.push({ session, ...image });
      return Promise.resolve({ ok: true, path: `uploads/maws-fixture-${images.length}.png` });
    };
  }
  if (options.openFile) host.openFile = (abs, line) => void files.push({ abs, line });
  return host;
}

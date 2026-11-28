// The sheet's routes (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §N; T15 to T17; rule 4), in
// the chunk beside handler.ts, which has passed each request through the three checks and checked its credential
// before it comes here. Each holds the daemon while it is answered (an operation's hold, T15) and reaches C3's service
// through the spine; a spine that cannot be had is 503 with its reason.
//
// The service never refuses by throwing: it answers its own negative value, and this passes it on. A `read` of a name it
// does not hold is `{ model: null }`; a `put` or an `upload` it refuses is its own `refused` or `{ ok: false, why }`, each
// with 200; only a body that is gone is 404. A `put` sets `by: 'page'` on every line whatever the browser wrote and adds
// no check of its own: the service holds each line to a surface's. A body goes out as plain text or as one of the four
// raster types, by the record's own account of it and never by its bytes or a name (rule 4): a captured HTML or SVG
// file is text. An upload arrives as the image's bytes under one of those four types, held to 5 MiB here before the
// service, which checks them against the type's signature, sees them.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SheetImageTypeSchema, type SheetLine } from '@shared/sheet/model';
import type { Route } from './checks';
import { refusal, STANDING_HEADERS, type Refusal } from './headers';
import { sendBytes } from './respond';
import { SheetsUnavailable, type SheetAccess } from './sheets';

export const PUT_BODY_MAX = 8 * 1024 * 1024; // fifty lines of 20,000 code points, with room
export const UPLOAD_BODY_MAX = 5 * 1024 * 1024; // the service's own bound, after the page's downscaling

export type SheetRoute = Extract<Route, { kind: 'read' | 'body' | 'put' | 'upload' }>;
export type BodyRead = Buffer | 'too-large' | 'aborted';

export interface SheetRoutesDeps {
  port(): number;
  sheets: SheetAccess;
  hold(reason: string, standing?: boolean): () => void;
  readBody(req: IncomingMessage, max: number): Promise<BodyRead>;
  json(res: ServerResponse, status: number, value: unknown): void;
  refuse(res: ServerResponse, refused: Refusal): void;
}

export const isSheetRoute = (route: Route): route is SheetRoute => route.kind === 'read' || route.kind === 'body' || route.kind === 'put' || route.kind === 'upload';

// `paired()` asks again whether the credential the request was admitted with is still a paired browser's: a write's body
// can finish after `mawsd sheet unpair`, so a put or an upload checks it once more immediately before the mutation is
// handed to the service, and is refused 401 when it no longer holds.
export function createSheetRoutes(deps: SheetRoutesDeps): (route: SheetRoute, req: IncomingMessage, res: ServerResponse, paired: () => boolean) => Promise<void> {
  const { json, refuse } = deps;

  const bytes = (res: ServerResponse, type: string, body: Buffer) => sendBytes(res, 200, { ...STANDING_HEADERS(deps.port()), 'Content-Type': type, 'Cache-Control': 'no-store' }, body);

  async function answer(route: SheetRoute, req: IncomingMessage, res: ServerResponse, paired: () => boolean): Promise<void> {
    switch (route.kind) {
      case 'read': {
        const service = await deps.sheets.service();
        const model = await service.read(route.session);
        return json(res, 200, { model, door: service.door() });
      }
      case 'body': {
        if (route.of === null) return refuse(res, refusal(404));
        const service = await deps.sheets.service();
        const body = await service.body(route.session, route.of);
        if (body.kind === 'text') return bytes(res, 'text/plain; charset=utf-8', Buffer.from(body.text, 'utf8'));
        if (body.kind === 'image' && SheetImageTypeSchema.safeParse(body.mediaType).success) return bytes(res, body.mediaType, Buffer.from(body.data, 'base64'));
        return refuse(res, refusal(404));
      }
      case 'put': {
        const read = await deps.readBody(req, PUT_BODY_MAX);
        if (read === 'aborted') return;
        if (read === 'too-large') return refuse(res, refusal(413));
        let lines: unknown;
        try {
          lines = (JSON.parse(read.toString('utf8')) as { lines?: unknown } | null)?.lines;
        } catch {
          return refuse(res, refusal(400));
        }
        if (!Array.isArray(lines)) return refuse(res, refusal(400));
        const stamped = lines.map((line: unknown) => (typeof line === 'object' && line !== null && !Array.isArray(line) ? { ...line, by: 'page' } : line)) as SheetLine[];
        const service = await deps.sheets.service();
        if (!paired()) return refuse(res, refusal(401)); // unpaired while its body came
        return json(res, 200, await service.put(route.session, stamped));
      }
      case 'upload': {
        const type = SheetImageTypeSchema.safeParse((req.headers['content-type'] ?? '').split(';', 1)[0]!.trim().toLowerCase());
        if (!type.success) return refuse(res, refusal(400));
        const read = await deps.readBody(req, UPLOAD_BODY_MAX);
        if (read === 'aborted') return;
        if (read === 'too-large') return refuse(res, refusal(413));
        const service = await deps.sheets.service();
        if (!paired()) return refuse(res, refusal(401));
        return json(res, 200, await service.upload(route.session, { mediaType: type.data, data: read.toString('base64') }));
      }
    }
  }

  return async (route, req, res, paired) => {
    const release = deps.hold(`the sheet page: ${route.kind}`);
    try {
      await answer(route, req, res, paired);
    } catch (error) {
      if (!(error instanceof SheetsUnavailable)) throw error; // not the spine's: the handler's 500
      if (!res.headersSent) json(res, 503, { why: error.why });
    } finally {
      release();
    }
  };
}


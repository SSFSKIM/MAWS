// P3-H H4: the relay between an HTML artifact page's connector runtime (`window.mawsConnectors`,
// src/main/artifacts/page-connectors.ts) and the page load's ArtifactHost connector surface. The page's end of the port
// is the page's: every request it posts is read against the portable request schemas (a malformed one is answered
// `invalid: request` here, a command the page has no word for is too), and it reaches only declare, call, watch,
// unwatch and refresh; the owner's grant, revoke, Start and the surface's visibility are never the page's.
//
// A watch's start is posted before any of its refreshes (the page registers the watch when it reads the start), and an
// unwatch or a refresh names only a watch this page started. A surface command that fails reads as the closed
// `failed: routeFailed` (false for an unwatch or a refresh), never the error's words. The owner's header hears what the
// page declares and each outcome per tool (`RelayReport`). Disposing closes the surface and the port and posts nothing more.
import * as z from 'zod';
import type { ConnectorSurface } from '@artifacts/host';
import {
  CONNECTOR_DECLARE_LIMIT,
  ConnectorCallRequestSchema,
  ConnectorToolRefSchema,
  ConnectorWatchRequestSchema,
  type ConnectorCallOutcome,
  type ConnectorRefusal,
  type ConnectorToolRef,
} from '@shared/artifacts/connectors';

// The app's end of a page's port (a MessagePort).
export interface PagePort {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

export interface RelayReport {
  declared?(tools: ConnectorToolRef[]): void; // everything the page has declared, after each declaration
  outcome?(tool: ConnectorToolRef, outcome: ConnectorCallOutcome): void; // each call's and refresh's outcome
}

export interface PageRelay {
  refreshWatches(): void; // the owner's: each of the page's watches refreshes now, where main allows it
  dispose(): void;
}

const INVALID: ConnectorRefusal = { ok: false, state: 'invalid', reason: 'request' };
const FAILED: ConnectorRefusal = { ok: false, state: 'failed', reason: 'routeFailed' };

const RequestSchema = z.looseObject({ id: z.number().int().positive(), op: z.string() });
const DeclareSchema = z.array(ConnectorToolRefSchema).max(CONNECTOR_DECLARE_LIMIT);
const WatchIdSchema = z.string().min(1).max(256);

export function relayPage(port: PagePort, surface: ConnectorSurface, report: RelayReport = {}): PageRelay {
  let live = true;
  const watches = new Set<string>();
  const post = (message: unknown) => {
    if (live) port.postMessage(message);
  };
  const answerWith = (id: number, work: Promise<unknown>, failed: unknown) =>
    void work.then(
      (answer) => post({ id, answer }),
      () => post({ id, answer: failed }),
    );
  const toolOf = ({ server, tool }: ConnectorToolRef): ConnectorToolRef => ({ server, tool });

  const declare = async (tools: ConnectorToolRef[]) => {
    const outcome = await surface.declareTools(tools);
    if (outcome.ok && live) report.declared?.(outcome.declared);
    return outcome;
  };

  const call = async (request: z.infer<typeof ConnectorCallRequestSchema>) => {
    const outcome = await surface.callTool(request);
    if (live) report.outcome?.(toolOf(request), outcome);
    return outcome;
  };

  const watch = async (id: number, request: z.infer<typeof ConnectorWatchRequestSchema>) => {
    const tool = toolOf(request);
    let started: string | null = null;
    const early: ConnectorCallOutcome[] = [];
    const heard = (update: ConnectorCallOutcome) => {
      if (!live) return;
      report.outcome?.(tool, update);
      if (started === null) early.push(update);
      else post({ watchId: started, update });
    };
    let start;
    try {
      start = await surface.watchTool(request, heard);
    } catch {
      return post({ id, answer: FAILED });
    }
    post({ id, answer: start });
    if (!start.ok) return;
    started = start.watchId;
    watches.add(started);
    for (const update of early.splice(0)) post({ watchId: started, update });
  };

  port.onmessage = ({ data }) => {
    const parsed = RequestSchema.safeParse(data);
    if (!live || !parsed.success) return;
    const { id, op } = parsed.data;
    switch (op) {
      case 'declare': {
        const tools = DeclareSchema.safeParse(parsed.data.tools);
        return tools.success ? answerWith(id, declare(tools.data), FAILED) : post({ id, answer: INVALID });
      }
      case 'call': {
        const request = ConnectorCallRequestSchema.safeParse(parsed.data.request);
        return request.success ? answerWith(id, call(request.data), FAILED) : post({ id, answer: INVALID });
      }
      case 'watch': {
        const request = ConnectorWatchRequestSchema.safeParse(parsed.data.request);
        return request.success ? void watch(id, request.data) : post({ id, answer: INVALID });
      }
      case 'unwatch':
      case 'refresh': {
        const watchId = WatchIdSchema.safeParse(parsed.data.watchId);
        if (!watchId.success || !watches.has(watchId.data)) return post({ id, answer: false });
        if (op === 'unwatch') watches.delete(watchId.data);
        return answerWith(id, op === 'unwatch' ? surface.unwatchTool(watchId.data) : surface.refreshWatch(watchId.data), false);
      }
      default:
        return post({ id, answer: INVALID });
    }
  };

  return {
    refreshWatches: () => {
      for (const watchId of watches) void surface.refreshWatch(watchId).catch(() => {});
    },
    dispose: () => {
      if (!live) return;
      live = false;
      port.onmessage = null;
      port.close();
      surface.close();
    },
  };
}

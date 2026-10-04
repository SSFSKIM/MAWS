// One session's remote surface (R2; charter D-9 as amended 2026-10-01, the waves plan's R2 rulings): MAWS attaches once
// per process as surface "desktop" right after `initialize` when the engine advertises `ui_surface_v1`, reads the pane
// roster (what a surface that places panes reads on mount), and detaches as the process ends. The engine's requests to
// the surface (`ui_copy`, `ui_prompt_read`, `ui_prompt_fill`, `ui_prompt_suggest`) wait here for the renderer's answer
// (`session.ui.answer`, from the window showing the session); one no window answers in time is refused just inside the
// engine's own 5 s, so every request the journal holds has its answer beside it. The normaliser turns the request rows
// into `plugin.ask`; nothing here builds an event.
import { DEFAULT_SURFACE_VIEWPORT, SURFACE_ANSWER_MS, SURFACE_ANSWERS, SURFACE_CLIENT_ID, type SurfaceAnswer } from '@shared/engine/surface';
import type { RequestId } from '@shared/graph/ids';
import { isSurfaceRequest, type SurfaceRequestSubtype } from '@shared/wire/control';
import type { ControlRequestFrame } from '@shared/wire/frames';
import { uiAttach, uiDetach, uiPanes } from './controls';
import type { ControlClient } from './rpc';

// The engine resolves an unanswered request after 5 s; the host refuses at 4 s (shared with the renderer, which acts on
// no request older than that), so the refusal is the answer it reads.
export { SURFACE_ANSWER_MS };
export const SURFACE_CAPABILITY = 'ui_surface_v1';

// What each request answers when no window took it (the engine's own unanswered outcomes, said explicitly).
const REFUSALS: Record<SurfaceRequestSubtype, Record<string, unknown>> = {
  ui_copy: { copied: false },
  ui_prompt_read: { text: '', cursor: 0 },
  ui_prompt_fill: { filled: false },
  ui_prompt_suggest: { shown: false },
};
const ASK_OF: Record<SurfaceRequestSubtype, SurfaceAnswer['ask']> = { ui_copy: 'copy', ui_prompt_read: 'prompt_read', ui_prompt_fill: 'prompt_fill', ui_prompt_suggest: 'prompt_suggest' };

function wireAnswer(answer: SurfaceAnswer): Record<string, unknown> {
  switch (answer.ask) {
    case 'copy':
      return { copied: answer.copied };
    case 'prompt_read':
      return { text: answer.text, cursor: answer.cursor };
    case 'prompt_fill':
      return { filled: answer.filled };
    case 'prompt_suggest':
      return { shown: answer.shown };
  }
}

export interface SessionSurfaceDeps {
  log: (message: string) => void;
  touch: () => void; // the status carries `uiSurface` while attached
  answerMs?: number;
}

export class SessionSurface {
  readonly clientId = SURFACE_CLIENT_ID;
  private state: 'detached' | 'attaching' | 'attached' | 'ended' = 'detached';
  private readonly asks = new Map<RequestId, { subtype: SurfaceRequestSubtype; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly deps: SessionSurfaceDeps) {}

  get attached(): boolean {
    return this.state === 'attached';
  }

  // The fields every surface request carries (the attach's own client).
  get address(): { surface: 'desktop'; client_id: string } {
    return { surface: 'desktop', client_id: this.clientId };
  }

  // Attaches when the engine advertises the protocol, once per process; a refusal or a failure leaves the session
  // without plugin drawings and says why in the log, never failing the launch.
  async attach(client: ControlClient, capabilities: readonly string[] | undefined): Promise<void> {
    if (this.state !== 'detached' || !capabilities?.includes(SURFACE_CAPABILITY)) return;
    this.state = 'attaching';
    try {
      await uiAttach(client, { ...this.address, viewport: { ...DEFAULT_SURFACE_VIEWPORT }, answers: [...SURFACE_ANSWERS] });
      if (this.state !== 'attaching') return; // detach/exit invalidates even an answer whose continuation was queued
      this.state = 'attached';
      this.deps.touch();
      await uiPanes(client, { client_id: this.clientId }); // the answer becomes `plugin.panes` (the normaliser)
    } catch (error) {
      if (this.state === 'attaching') this.state = 'detached';
      this.deps.log(`the engine surface did not attach: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The session is ending: no later attach is allowed for this process. An in-flight attach already went onto the
  // pipe, so its detach follows it before `end_session`, without waiting for the attach answer's continuation.
  detach(client: ControlClient | null): void {
    const active = this.state === 'attaching' || this.state === 'attached';
    this.state = 'ended';
    if (!active) return;
    if (client) uiDetach(client, { client_id: this.clientId }).catch(() => {}); // the exit is the answer that matters
    this.deps.touch();
  }

  // One of the engine's requests to the surface: held for the renderer, refused at SURFACE_ANSWER_MS.
  accept(req: ControlRequestFrame, respond: (requestId: RequestId, response: unknown) => Promise<void>): void {
    const subtype = req.request.subtype;
    if (!isSurfaceRequest(subtype)) return;
    const requestId = req.request_id as RequestId;
    const timer = setTimeout(() => {
      if (!this.asks.delete(requestId)) return;
      respond(requestId, REFUSALS[subtype]).catch((error: unknown) => this.deps.log(`${subtype} refusal not written: ${error instanceof Error ? error.message : String(error)}`));
    }, this.deps.answerMs ?? SURFACE_ANSWER_MS);
    (timer as { unref?: () => void }).unref?.();
    this.asks.set(requestId, { subtype, timer });
  }

  // The renderer's answer: written once, while the request still waits; an answer of another kind is refused.
  async answer(requestId: RequestId, answer: SurfaceAnswer, respond: (requestId: RequestId, response: unknown) => Promise<void>): Promise<'delivered' | 'not_pending'> {
    const pending = this.asks.get(requestId);
    if (!pending) return 'not_pending';
    if (ASK_OF[pending.subtype] !== answer.ask) throw new Error(`${pending.subtype} ${requestId} cannot take a ${answer.ask} answer`);
    this.asks.delete(requestId);
    clearTimeout(pending.timer);
    await respond(requestId, wireAnswer(answer));
    return 'delivered';
  }

  pending(requestId: RequestId): boolean {
    return this.asks.has(requestId);
  }

  // The process is gone: nothing is attached and nothing waits.
  processExited(): void {
    for (const { timer } of this.asks.values()) clearTimeout(timer);
    this.asks.clear();
    this.state = 'ended';
  }
}

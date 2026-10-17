// P3-H "Send to" a connector (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H; Decision Log 24, 87, 88): from a
// library row's Export submenu, the owner sends the artifact to Google Drive or Notion as an agent action. The run:
//   1. the export: `artifacts.export` of the chosen format with `ownFile` writes a file of its own under the store's
//      directory, its name minted before it renders (Decision Log 91), so no later export of the same revision and
//      format replaces it while the run waits; it answers that path and revision (no Save dialog); the turn delivers
//      that file, never the artifact's mutable content;
//   2. the session (H4's owner-Start context, ../artifacts/session-context.ts): the artifact's own session, else a new
//      one in its Space's linked directory or its project's, never a guessed root. A live one is used as it is; any
//      other is started or resumed first, with no message (Decision Log 88: a prompt held in it refuses the start and
//      stays there), which the owner confirmed in the same sheet;
//   3. the turn: the owner's request through the one human prompt path (`sendHumanPrompt`, origin `sendTo`), a real
//      model turn in which the connector's tool runs under the session's ordinary approval cards (a connector grant on
//      the artifact pre-approves nothing here); then the app opens the session.
// A run is the sheet's, outside React: the sheet shows its phase, closing the sheet cancels it (nothing is sent after a
// cancel), and a failed run is tried again by the same gesture, reusing the session an earlier attempt created.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import type { ArtifactSessionContext, ArtifactSessionEnd, ArtifactSessionStart } from '../artifacts/session-context';
import type { HumanPromptOptions, HumanPromptResult } from '../composer/submit/send-human-prompt';
import { VIEWERS_COPY } from '../tools/artifacts/viewers/copy';
import { KIND_LABELS } from './copy';

export type SendTarget = 'drive' | 'notion';

export const SEND_TARGETS: Record<SendTarget, { name: string; prefer: readonly ArtifactExportFormat[] }> = {
  // Drive keeps Office files editable (a deck as PowerPoint), else a PDF
  drive: { name: 'Google Drive', prefer: ['docx', 'pptx', 'pdf', 'md', 'html', 'png', 'claude'] },
  // Notion imports Markdown as pages, else a PDF
  notion: { name: 'Notion', prefer: ['md', 'pdf', 'html', 'docx', 'pptx', 'png', 'claude'] },
};

// The format a target starts with among those the kind's exporters serve (null: none, so no Send to).
export function defaultSendFormat(target: SendTarget, formats: readonly ArtifactExportFormat[]): ArtifactExportFormat | null {
  return SEND_TARGETS[target].prefer.find((format) => formats.includes(format)) ?? formats[0] ?? null;
}

// The artifact's title is not here: it is the agent's or an import's text, so it is shown in the sheet and never sent
// (Decision Log 91).
export interface SendRequest {
  artifactId: string;
  kind: ArtifactKind;
  target: SendTarget;
  format: ArtifactExportFormat;
  context: ArtifactSessionContext;
}

// The owner's request as the session reads it: the exported file and where it goes. The connector is named by its
// service, not a tool name: the session has whatever Drive or Notion connector the owner configured. Every word is the
// owner's choice (the target, the format) or main's (the path it wrote, the revision); nothing the artifact's author
// wrote (Decision Log 91).
export function sendToPrompt(request: Pick<SendRequest, 'kind' | 'target' | 'format'>, exported: { path: string; revision: number }): string {
  const service = SEND_TARGETS[request.target].name;
  return [
    `Send this file to ${service}:`,
    '',
    `\`${exported.path}\``,
    '',
    `It is the artifact (${KIND_LABELS[request.kind]}, revision ${exported.revision}) exported as ${VIEWERS_COPY.exportFormats[request.format]}, the version the owner chose to send, so upload it as it is with a ${service} connector available in this session.`,
    `If no ${service} connector here can take a file, say so rather than reaching ${service} another way. Once it is uploaded, say where it is.`,
  ].join('\n');
}

export type SendToPhase =
  | { phase: 'confirm' }
  | { phase: 'exporting' }
  | { phase: 'starting'; appSessionId: AppSessionId | null }
  | { phase: 'sending'; appSessionId: AppSessionId }
  | { phase: 'sent'; appSessionId: AppSessionId }
  | { phase: 'failed'; words: string; appSessionId: AppSessionId | null } // with a session: the owner may open it
  | { phase: 'cancelled' };

export const isPending = (state: SendToPhase): boolean => state.phase === 'exporting' || state.phase === 'starting' || state.phase === 'sending';

export interface SendToDeps {
  client: MawsBridge;
  start(context: ArtifactSessionContext, previous: AppSessionId | null): Promise<ArtifactSessionStart>;
  send(appSessionId: AppSessionId, prompt: string, options: HumanPromptOptions): Promise<HumanPromptResult>;
  isLive(appSessionId: AppSessionId): boolean; // its engine is ready now
  open(appSessionId: AppSessionId): void;
}

export interface SendToRun {
  state: StoreApi<SendToPhase>;
  // The session an earlier attempt of this run created or resumed, which a retry reuses rather than making another.
  previous(): AppSessionId | null;
  send(request: SendRequest): Promise<void>;
  cancel(): void;
}

const SEND_REFUSED = 'The session didn’t take the request';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createSendToRun(deps: SendToDeps): SendToRun {
  const state = createStore<SendToPhase>()(() => ({ phase: 'confirm' }));
  let attempt = 0; // a cancel or a newer attempt ends the older one: it changes nothing after
  let previous: AppSessionId | null = null;
  let stopWaiting: (() => void) | null = null;

  // The session the turn goes to, or the failure that ends the attempt.
  const session = async (request: SendRequest, current: () => boolean): Promise<AppSessionId | SendToPhase | null> => {
    const { context } = request;
    if (context.kind === 'session' && deps.isLive(context.appSessionId)) return context.appSessionId;
    if (context.kind === 'directory' && previous !== null && deps.isLive(previous)) return previous;
    state.setState({ phase: 'starting', appSessionId: context.kind === 'session' ? context.appSessionId : previous }, true);
    let started: ArtifactSessionStart;
    try {
      started = await deps.start(context, previous);
    } catch (error) {
      return { phase: 'failed', words: messageOf(error), appSessionId: null };
    }
    if (started.appSessionId !== null && context.kind === 'directory') previous = started.appSessionId;
    let end: ArtifactSessionEnd;
    if (started.status === 'starting') {
      if (!current()) {
        started.cancel();
        return null;
      }
      stopWaiting = started.cancel;
      state.setState({ phase: 'starting', appSessionId: started.appSessionId }, true);
      end = await started.settled;
      stopWaiting = null;
    } else end = started;
    if (!current()) return null;
    if (end.status === 'ready') return end.appSessionId;
    return { phase: 'failed', words: end.words, appSessionId: end.appSessionId };
  };

  return {
    state,
    previous: () => previous,
    async send(request) {
      const mine = ++attempt;
      const current = () => attempt === mine;
      state.setState({ phase: 'exporting' }, true);
      let exported;
      try {
        exported = await deps.client.invoke('artifacts.export', { artifactId: request.artifactId, format: request.format, ownFile: true });
      } catch (error) {
        exported = { ok: false as const, error: { message: messageOf(error) } };
      }
      if (!current()) return;
      if (!exported.ok) return state.setState({ phase: 'failed', words: VIEWERS_COPY.exportFailed(exported.error.message), appSessionId: null }, true);
      const target = await session(request, current);
      if (!current() || target === null) return;
      if (typeof target !== 'string') return state.setState(target, true);
      state.setState({ phase: 'sending', appSessionId: target }, true);
      let result: HumanPromptResult;
      try {
        // Decision Log 88 holds through any acquisition the send itself makes (a session gone cold since it was ready)
        result = await deps.send(target, sendToPrompt(request, exported.value), { origin: 'sendTo', requireEmptyMessage: true, current });
      } catch (error) {
        if (current()) state.setState({ phase: 'failed', words: messageOf(error), appSessionId: target }, true);
        return;
      }
      if (!current()) return;
      if (result.disposition === 'sent' || result.disposition === 'steered' || result.disposition === 'queued') {
        state.setState({ phase: 'sent', appSessionId: target }, true);
        deps.open(target);
        return;
      }
      state.setState({ phase: 'failed', words: result.reason ?? SEND_REFUSED, appSessionId: target }, true);
    },
    cancel() {
      if (state.getState().phase === 'sent') return;
      attempt += 1;
      stopWaiting?.();
      stopWaiting = null;
      state.setState({ phase: 'cancelled' }, true);
    },
  };
}

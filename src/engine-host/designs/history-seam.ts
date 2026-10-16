// The design's e2e seam (P3-E1 M4; docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4): what
// `e2e/design-comments.spec.ts` and `e2e/design-history.spec.ts` drive the engine host through to make an agent's changes
// to a design in the product build with no engine, C's deck history seam (../presentations/history-seam.ts) for a
// design. Started by `registerDesigns` only when the host runs under MAWS_E2E=1 with MAWS_DESIGN_HISTORY naming the
// channel's directory; refused otherwise.
//
// A `write` command applies one of the design model's writers, or one of C's thread writers (an agent's reply or
// resolution, as B's `artifact_reply` and `artifact_resolve` write them for a design), to the design through the
// host's `writeAs` as the session it names (so the update, its provenance and the log row are that session's, as an
// agent's tool's are), then writes the `auto` version the store's scheduler writes after a stretch of activity, credited
// to the session: what "See N new changes" compares the live design with. Commands arrive as JSON files in `<dir>/in`
// (written beside and renamed in) and are answered in `<dir>/out` under the same name; no IPC name is added.
//
//   write  {artifactId, session, edit}
//     edit: {op: 'setStyle', boardId, elementId, props} | {op: 'setFrame', boardId, frame}
//         | {op: 'move', from, to, elementId}  (answers the moved element's new id)
//         | {op: 'reply', threadId, body} | {op: 'resolve', threadId}
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardFrame } from '@artifacts/design/canvas';
import { moveElementToBoard } from '@artifacts/design/move';
import { setBoardFrame } from '@artifacts/design/writers';
import { setStyle } from '@artifacts/slides/model';
import { reply, resolve } from '@artifacts/slides/threads';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { DocumentService } from '../documents/service';
import type { ArtifactStore } from '../documents/store';

export type DesignSeamEdit =
  | { op: 'setStyle'; boardId: string; elementId: string; props: Record<string, string | null> }
  | { op: 'setFrame'; boardId: string; frame: Partial<BoardFrame> }
  | { op: 'move'; from: string; to: string; elementId: string }
  | { op: 'reply'; threadId: string; body: string }
  | { op: 'resolve'; threadId: string };
export type DesignSeamCommand = { cmd: 'write'; artifactId: string; session: string; edit: DesignSeamEdit };
export type DesignSeamAnswer = { ok: true; revision: number; moved?: string } | { ok: false; error: string };

const POLL_MS = 50;

/** Whether the host was started for this seam (MAWS_E2E=1 and the channel's directory named). */
export const designSeamDir = (env: Record<string, string | undefined>): string | null => (env.MAWS_E2E === '1' && env.MAWS_DESIGN_HISTORY ? env.MAWS_DESIGN_HISTORY : null);

/** Runs one command: the edit as the session, then the scheduler's `auto` version (credited to the session). */
export async function runDesignSeamCommand(deps: { store: Pick<ArtifactStore, 'autoVersion' | 'get'>; service: Pick<DocumentService, 'writeAs'> }, command: DesignSeamCommand): Promise<DesignSeamAnswer> {
  try {
    if (command.cmd !== 'write') throw new Error(`unknown command ${String((command as { cmd: unknown }).cmd)}`);
    if (deps.store.get(command.artifactId)?.kind !== 'design') throw new Error(`${command.artifactId} is not a design`);
    const { edit } = command;
    const actor: Actor = { kind: 'session', appSessionId: command.session as AppSessionId };
    let moved: string | undefined;
    const revision = await deps.service.writeAs(command.artifactId, actor, (doc) => {
      const at = Date.now();
      if (edit.op === 'setStyle') setStyle(doc, edit.boardId, edit.elementId, edit.props);
      else if (edit.op === 'setFrame') setBoardFrame(doc, edit.boardId, edit.frame);
      else if (edit.op === 'move') moved = moveElementToBoard(doc, edit.from, edit.to, edit.elementId).ids.get(edit.elementId);
      else if (edit.op === 'reply') reply(doc, edit.threadId, { id: `${edit.threadId}:agent-${at}`, by: actor, at, body: edit.body });
      else resolve(doc, edit.threadId, actor, at);
    });
    await deps.store.autoVersion(command.artifactId);
    return { ok: true, revision, ...(moved !== undefined && { moved }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Serves the channel in `dir` until `close`, one command at a time in name order. */
export function startDesignSeam(deps: Parameters<typeof runDesignSeamCommand>[0], dir: string, log: (line: string) => void = (line) => console.warn(`[design-history] ${line}`)): { close(): void } {
  const inbox = join(dir, 'in');
  const outbox = join(dir, 'out');
  mkdirSync(inbox, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  let running = false;
  let closed = false;
  const drain = async () => {
    if (running || closed) return;
    running = true;
    try {
      for (const name of readdirSync(inbox).filter((file) => file.endsWith('.json')).sort()) {
        const path = join(inbox, name);
        let command: DesignSeamCommand;
        try {
          command = JSON.parse(readFileSync(path, 'utf8')) as DesignSeamCommand;
        } finally {
          rmSync(path, { force: true });
        }
        const answer = await runDesignSeamCommand(deps, command);
        if (!answer.ok) log(`${name}: ${answer.error}`);
        writeFileSync(join(outbox, `${name}.tmp`), JSON.stringify(answer));
        renameSync(join(outbox, `${name}.tmp`), join(outbox, name));
      }
    } catch (error) {
      log(`the channel failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const poll = setInterval(() => void drain(), POLL_MS);
  poll.unref();
  return {
    close: () => {
      closed = true;
      clearInterval(poll);
    },
  };
}

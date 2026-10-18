// The deck history's e2e seam (P3-C M8 fix wave 1, R4; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11,
// Acceptance 5's "See N new changes"): what `e2e/presentations-history.spec.ts` drives the engine host through to make an
// agent's change to a deck between two of the owner's views, in the product build with no engine. Started by
// `registerPresentations` only when the host runs under MAWS_E2E=1 with MAWS_PRESENTATIONS_HISTORY naming the channel's
// directory; refused otherwise.
//
// A `write` command applies one of the deck model's writers to the deck through the host's `writeAs` as the session it
// names (so the update, its provenance and the log row are that session's, as an agent's publish is), then writes the
// `auto` version the store's scheduler writes after a stretch of activity, credited to the last writer (the session):
// the version "See N new changes" compares the live deck with. Commands arrive as JSON files in `<dir>/in` (written
// beside and renamed in) and are answered in `<dir>/out` under the same name; no IPC name is added (B's document seam's
// channel, served by a small poll of its own here).
//
//   write  {artifactId, session, edit}   edit: {op: 'setStyle', slideId, elementId, props} | {op: 'setNotes', slideId, text}
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setNotes, setStyle } from '@artifacts/slides/model';
import type { AppSessionId } from '@shared/graph/ids';
import type { DocumentService } from '../documents/service';
import type { ArtifactStore } from '../documents/store';

export type DeckHistoryEdit = { op: 'setStyle'; slideId: string; elementId: string; props: Record<string, string | null> } | { op: 'setNotes'; slideId: string; text: string };
export type DeckHistoryCommand = { cmd: 'write'; artifactId: string; session: string; edit: DeckHistoryEdit };
export type DeckHistoryAnswer = { ok: true; revision: number } | { ok: false; error: string };

const POLL_MS = 50;

/** Whether the host was started for this seam (MAWS_E2E=1 and the channel's directory named). */
export const historySeamDir = (env: Record<string, string | undefined>): string | null => (env.MAWS_E2E === '1' && env.MAWS_PRESENTATIONS_HISTORY ? env.MAWS_PRESENTATIONS_HISTORY : null);

/** Runs one command: the edit as the session, then the scheduler's `auto` version (credited to the session). */
export async function runDeckHistoryCommand(deps: { store: Pick<ArtifactStore, 'autoVersion' | 'get'>; service: Pick<DocumentService, 'writeAs'> }, command: DeckHistoryCommand): Promise<DeckHistoryAnswer> {
  try {
    if (command.cmd !== 'write') throw new Error(`unknown command ${String((command as { cmd: unknown }).cmd)}`);
    const artifact = deps.store.get(command.artifactId);
    if (artifact?.kind !== 'presentation') throw new Error(`${command.artifactId} is not a presentation`);
    const { edit } = command;
    const revision = await deps.service.writeAs(command.artifactId, { kind: 'session', appSessionId: command.session as AppSessionId }, (doc) => {
      if (edit.op === 'setStyle') setStyle(doc, edit.slideId, edit.elementId, edit.props);
      else setNotes(doc, edit.slideId, edit.text);
    });
    await deps.store.autoVersion(command.artifactId);
    return { ok: true, revision };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Serves the channel in `dir` until `close`, one command at a time in name order. */
export function startDeckHistorySeam(deps: Parameters<typeof runDeckHistoryCommand>[0], dir: string, log: (line: string) => void = (line) => console.warn(`[presentations-history] ${line}`)): { close(): void } {
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
        let command: DeckHistoryCommand;
        try {
          command = JSON.parse(readFileSync(path, 'utf8')) as DeckHistoryCommand;
        } finally {
          rmSync(path, { force: true });
        }
        const answer = await runDeckHistoryCommand(deps, command);
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

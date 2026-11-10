// The folder checks (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §F.6; its design §10): each
// declared row's folder is checked at start, every ten minutes, and when a start in it fails, and its state (`missing`,
// `replaced`) written when it changed, told as any project change is. Neither state removes anything.
import type { Statements } from './statements';

export const FOLDER_CHECK_MS = 10 * 60_000;

/** Checks every declared folder now and then every `intervalMs`; answers the stop. */
export function startFolderChecks(statements: Pick<Statements, 'checkFolders'>, intervalMs: number = FOLDER_CHECK_MS): () => void {
  const check = () => void statements.checkFolders().catch((error) => console.error('[index] the folder checks failed:', error instanceof Error ? error.message : error));
  check();
  const timer = setInterval(check, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

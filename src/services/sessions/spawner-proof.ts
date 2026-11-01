// The spawner's proof (P5 O12 M11, docs/doperpowers/plans/2026-10-27-p5-o12-sminos-owners.md, "The environment carries
// the spawner, a file carries the proof", Interfaces §H): a session a remote member spawned (its record's `launchedBy`)
// launches with MAWS_LAUNCHED_BY naming this file, from which sminos's record takes its `ownersProof`. The sealed action
// carries the spawn's brief, up to the channel's 4 MiB, which no environment holds (macOS bounds argv and environment
// together at 1 MiB), so it rides in a file: `<userData>/sessions/launched-by/<appSessionId>.json` beside the setup
// intents and the rewind notes, 0600, the canonical JSON of the envelope `{member, device, opId, action}` (the action
// carries no member; the endpoint's binding is the member). It is written whole (temp file, fsync, rename) before every
// launch that names it, from the session's own `launchedBy`, so a resume after the file was lost writes it again, and goes
// with the record.
import { mkdir, rm } from 'node:fs/promises';
import { canonicalize } from 'org-protocol';
import { atomicWriteFile } from '@shared/fs/atomic-write';
import type { AppSessionId } from '@shared/graph/ids';
import type { LaunchedBy } from '@shared/graph/session';
import { fileOf } from './json-files';

export class SpawnerProofs {
  constructor(readonly dir: string) {}

  /** The session's proof file, which its launch spec names. */
  pathOf(appSessionId: AppSessionId): string {
    return fileOf(this.dir, appSessionId);
  }

  /** The proof of `launchedBy`, the session's own, written whole before its launch; nothing for a session without one. */
  async write(appSessionId: AppSessionId, launchedBy: LaunchedBy | undefined): Promise<void> {
    if (launchedBy === undefined) return;
    const { member, device, opId, action } = launchedBy;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await atomicWriteFile(this.pathOf(appSessionId), canonicalize({ member, device, opId, action }));
  }

  /** The session's proof gone with its record; nothing when there is none. */
  async remove(appSessionId: AppSessionId): Promise<void> {
    await rm(this.pathOf(appSessionId), { force: true });
  }
}

// A transcript as the engine writes one, for a scan to discover (P5 O3-D M6 fix round 1): the store's folder for `repo`
// under `<config>/projects/`, one `<sessionId>.jsonl` whose first row is the human's prompt with its cwd, as
// e2e/support/maws-tools.ts's seedTranscripts writes them. Returns the session's engine id.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const transcriptFolder = (config: string, repo: string) => join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));

export function seedTranscript(config: string, repo: string, title: string, sessionId: string = randomUUID()): string {
  const folder = transcriptFolder(config, repo);
  mkdirSync(folder, { recursive: true });
  const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: title }, uuid: randomUUID(), timestamp: '2026-10-06T00:00:00.000Z', cwd: repo, sessionId, version: '2.1.291' };
  writeFileSync(join(folder, `${sessionId}.jsonl`), `${JSON.stringify(first)}\n`);
  return sessionId;
}

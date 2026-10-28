// Replays the vectors' history re-attestations (scenario-history.ts) through the package: each digest, and each case's
// verdict. Runtime-neutral, as the package is; `replayVectors` runs it with the rest.
import { historyDigest, verifyHistoryAttestation } from '../src/history.ts';
import type { HistoryVectors } from './scenario-history.ts';

export async function replayHistory(set: HistoryVectors): Promise<string[]> {
  const failures: string[] = [];
  for (const { events, digest } of set.digests) if ((await historyDigest(set.logs[events])) !== digest) failures.push(`history digest of ${events}`);
  for (const c of set.cases) {
    try {
      const got = await verifyHistoryAttestation(c.record, set.logs[c.events], set.heads[c.head], set.certificates[c.certificates], c.at, new Date(c.now));
      if (JSON.stringify(got) !== JSON.stringify(c.expect)) failures.push(`verifyHistoryAttestation: ${c.name}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    } catch (error) {
      failures.push(`verifyHistoryAttestation: ${c.name}: threw ${String(error)}`);
    }
  }
  return failures;
}

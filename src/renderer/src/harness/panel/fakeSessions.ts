// The `#panel` harness's fake sessions (C8a, ruling O1): records A (a plain directory) and B (a worktree), built from
// the committed harness scenario that main also serves under `MAWS_SESSION_SOURCE=stub:test/fixtures/panel/
// harness-sessions.json`, so main's read model knows both and `layout.set` accepts their panel keys. The page seeds
// `useSessions` itself: there is no `connectShell` here, whose snapshot would replace these records.
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import { SessionRecordSchema, type SessionRecord } from '@shared/graph/session';
import { SessionDigestSchema, type SessionDigest } from '@shared/ipc/schema';
import { useSessions } from '../../stores/sessions';
import scenario from '../../../../../test/fixtures/panel/harness-sessions.json';

export const FAKE_IDS = ['A', 'B'] as const;
export type FakeId = (typeof FAKE_IDS)[number];

const records = z.array(SessionRecordSchema).parse(scenario.sessions);
const digests = z.array(SessionDigestSchema.omit({ revision: true })).parse(scenario.digests);

export const FAKE_RECORDS: ReadonlyMap<AppSessionId, SessionRecord> = new Map(records.map((r) => [r.appId, r]));

export const fakeId = (id: FakeId): AppSessionId => id as AppSessionId;

export function seedFakeSessions(): void {
  useSessions.setState((s) => ({
    loaded: true,
    records: new Map(FAKE_RECORDS),
    digests: new Map(digests.map((d): [AppSessionId, SessionDigest] => [d.appSessionId, { ...d, revision: 1 }])),
    engine: new Map(),
    recordsVersion: s.recordsVersion + 1,
    digestsVersion: s.digestsVersion + 1,
  }));
}

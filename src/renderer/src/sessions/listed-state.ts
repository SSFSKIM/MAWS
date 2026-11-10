// What a record's state is read from (P5 O7 M10; docs/tech-debt-tracker.md, "a busy remote session's rank"): its digest,
// or, for another machine's lane B record, its listing. No lane B module emits a digest, so such a record, held while a
// tab here holds its address and kept after (main lets the session go quietly), has none; the listing the sessions
// store holds at its address still says its state (sminos's word, re-issued at each change of it), as it did for the
// listed row the record took the place of. Every reader of a record's state asks here: the glyph (`attention/glyph.ts`),
// the sidebar's working tier, rollups and age, and the Overview card's activity line.
import type { SessionDigest } from '@shared/ipc/schema';
import type { ListedSession } from '../stores/sessions';

/** The listing's word where it decides a record's state; null where the digest does (a record with one, or with no lane B listing). */
export const listedStateOf = (digest: SessionDigest | null | undefined, listed: ListedSession | undefined): string | null =>
  digest == null && listed?.lane === 'B' ? listed.state : null;

/** Mid-turn: its digest working or starting, or, with none, its lane B listing `busy`. */
export const isWorking = (digest: SessionDigest | null | undefined, listed?: ListedSession): boolean =>
  digest?.phase === 'working' || digest?.phase === 'starting' || listedStateOf(digest, listed) === 'busy';

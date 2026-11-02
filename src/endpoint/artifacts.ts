// The `artifact` target rule's standing and its cache (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// M5 "The `artifact` target rule"; the owner's A12, answered as recommended on 2026-11-01).
//
// Who stands on an artifact. A member who is one of the machine's owners holds `manage` on every artifact of the machine,
// read before any link is resolved (the machine's own app shows anyone at the machine everything, and a listing then
// costs no placement per row). Any other member holds the highest rank they hold on any of the artifact's linked
// sessions (a member who may view a session the artifact is linked to may view the artifact: that session's transcript
// already shows it); an artifact with no link (`orphan`: the person's own create or duplicate, an import with no links, a
// seeded design system) is the machine owners' alone, as a session owned by `@machine` is. `holdsArtifact` is that one
// predicate: authorization's decision (authorize.ts, each session's record read through its `Reads`), `library.list`'s
// per-row cut (calls.ts) and the `artifacts` feed (artifacts-feed.ts) each ask it, each with its own reading of a
// session's rank.
//
// The cache (`ArtifactRanks`). An artifact's placement (`library.entry` and a `laneB` placement per link: targets.ts'
// `placeArtifact`) is kept per channel and artifact, 256 entries a channel, first in first out, so a page's many requests
// and a feed's many events cost one read each. What it keeps is the placement, never a rank: every decision still reads
// each linked session's record when it is taken. An entry is dropped by everything that can change what it says or what
// is decided on it: a record change naming one of its sessions (a record's first arrival included, which ends O12 M11's
// bridge), a change of a linked session's engine session in the spine's index (`session.changed`), the artifact's
// relink (`artifacts.changed {change: 'linked'}`), a `caps` refresh and a new head (`clear`); a channel's entries go
// with it (its ref's end). A placement in flight when anything is dropped is dropped too (what it read may predate the
// change), and a reader handed an entry dropped while it read reads again, once, then answers `unavailable`, as a
// decision whose reads moved twice does. A placement that could not be read (`unavailable`) is never kept.
import type { ClientRef } from '@shared/ipc/client';
import type { SessionTarget } from './sources';
import { placeArtifact, type PlacedSession, type Placing, type Resolved } from './targets';

/** How many artifacts' placements one channel keeps. */
export const ARTIFACT_RANKS_KEPT = 256;

/** An artifact as the rule placed it (targets.ts' `artifact` form). */
export type PlacedArtifact = Extract<Resolved, { kind: 'artifact' }>;

/**
 * Whether a member holds a grade on `artifact`: as one of the machine's owners (`ownsMachine`), or, for an artifact with
 * a link, on one of its linked sessions (`holds`, the caller's own reading of a session's rank at that grade).
 */
export function holdsArtifact<S = PlacedSession>(artifact: { readonly sessions: readonly S[]; readonly orphan: boolean }, ownsMachine: boolean, holds: (session: S) => boolean): boolean {
  if (ownsMachine) return true;
  return !artifact.orphan && artifact.sessions.some(holds);
}

/** A placement read through the cache, and whether its entry still stands (nothing dropped it since). */
export type CachedPlacement = { resolved: Resolved; current(): boolean };

type Entry = {
  read: Promise<Resolved>;
  /** Once settled: its linked sessions, by app session and, for those placed, engine session (a drop naming one drops it). */
  sessions: Set<string> | null;
};

export class ArtifactRanks {
  /** Each channel's entries by artifact id, in insertion order. Keyed by the channel's ref; `null`: no channel. */
  readonly #channels = new Map<ClientRef | null, Map<string, Entry>>();

  /**
   * The artifact's placement for `channel`, read on its behalf through `placing` when not kept. Read again, once, when
   * its entry was dropped while it was read; dropped again, `unavailable`.
   */
  async of(channel: ClientRef | undefined, artifactId: string, placing: Placing): Promise<CachedPlacement> {
    const key = channel ?? null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const entry = this.#entry(key, artifactId, placing);
      const resolved = await entry.read;
      if (resolved.kind === 'refused') return { resolved, current: () => true };
      if (this.#stands(key, artifactId, entry)) return { resolved, current: () => this.#stands(key, artifactId, entry) };
    }
    return { resolved: { kind: 'refused', reason: 'unavailable' }, current: () => true };
  }

  /** The artifact relinked: every channel's entry for it dropped. */
  drop(artifactId: string): void {
    for (const entries of this.#channels.values()) entries.delete(artifactId);
  }

  /**
   * A linked session's record or its placement changed (`target` from the record source; an app session id from the
   * spine's index): every entry placing it, and every one still being read, dropped.
   */
  dropSession(session: SessionTarget | string): void {
    const names = typeof session === 'string' ? [session] : session.lane === 'B' ? [session.session, session.appSessionId] : [session.session];
    for (const entries of this.#channels.values()) {
      for (const [id, entry] of entries) if (entry.sessions === null || names.some((name) => name !== '' && entry.sessions!.has(name))) entries.delete(id);
    }
  }

  /** The channel ended: its entries go with it. */
  dropChannel(channel: ClientRef): void {
    this.#channels.delete(channel);
  }

  /** A `caps` refresh or a new head: everything dropped. */
  clear(): void {
    for (const entries of this.#channels.values()) entries.clear();
  }

  #stands(key: ClientRef | null, artifactId: string, entry: Entry): boolean {
    return this.#channels.get(key)?.get(artifactId) === entry;
  }

  #entry(key: ClientRef | null, artifactId: string, placing: Placing): Entry {
    let entries = this.#channels.get(key);
    if (entries === undefined) {
      entries = new Map();
      this.#channels.set(key, entries);
      if (key !== null) key.onGone(() => this.dropChannel(key));
    }
    const kept = entries.get(artifactId);
    if (kept !== undefined) return kept;
    if (entries.size >= ARTIFACT_RANKS_KEPT) entries.delete(entries.keys().next().value!);
    const entry: Entry = { read: placeArtifact(artifactId, placing), sessions: null };
    entries.set(artifactId, entry);
    void entry.read.then((resolved) => {
      if (resolved.kind === 'refused') {
        if (this.#stands(key, artifactId, entry)) this.#channels.get(key)!.delete(artifactId);
        return;
      }
      entry.sessions = new Set(resolved.kind === 'artifact' ? [...resolved.linked, ...resolved.sessions.map((s) => s.target.session)] : []);
    });
    return entry;
  }
}

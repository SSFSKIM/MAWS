// Released index migrations are never edited (E11 W-E; the tracker's C4 · index row): v1 gained `sessions.removed_at`
// in place after the owner's database had applied it, and only the opener's REPAIRS saved that database. Each released
// entry is pinned here by its version and the SHA-256 of its SQL, so an edit fails this suite until the change moves to
// a new entry (or a repair). An entry is added here when it is released (merged to master); an entry after the last
// pinned one is still unreleased and free to change.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './migrations';

const RELEASED: readonly { version: number; sha256: string }[] = [
  { version: 1, sha256: 'f18fabc61bab429ec87adab005cfa01a8eeaa9e33b2c6253897e7ff7db5b4e02' }, // C4, amended with removed_at (REPAIRS)
  { version: 2, sha256: '280b047c5cc7964dbf3a92ca3f0b83d4109494c8c3bff521eed87a5fd2e305f4' },
  { version: 3, sha256: '50620e8146f069fd67d0e384808a742abd674cd386b677a60a40c1168cd78ead' },
  { version: 4, sha256: 'aadd6abf8c3c55fbaa37cf57fd26bfd8346c521d671780a168dab80b7a11215e' }, // E3: lineage, side threads (X15)
  { version: 5, sha256: '95c75547a8bc8a48c9ddfe17aa4dbdbe26cd1608ec91270050c63c78811abb31' }, // E4a: browser history (X15)
  { version: 6, sha256: '261027e33d3c4806180a8b704ba75169d06b86fb1ed63c172de608c967fb6390' }, // cua board #93: the agent's browser activity (X15)
];

const digest = (sql: string) => createHash('sha256').update(sql).digest('hex');

describe('the index migrations', () => {
  it('number their entries 1, 2, 3, … in order (version N is the N-th entry)', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, k) => k + 1));
  });

  it.each(RELEASED)('keep released entry $version as it shipped', ({ version, sha256 }) => {
    const entry = MIGRATIONS.find((m) => m.version === version);
    expect(entry, `migration ${version} is gone`).toBeDefined();
    expect(digest(entry!.sql), `migration ${version} was edited after its release: append a new entry (or a repair) instead`).toBe(sha256);
  });
});

// P2-E1 G4 (D10): the artifact scope main resolves at launch and, since P2-F L122, the window resolves for `show_pane`.
// A side thread's ancestors, nearest first, up to the family root (the first ancestor that is not itself a side thread,
// included); empty for a root or a fork.
import { describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { Lineage, SessionRecord } from '@shared/graph/session';
import { ARTIFACT_SCOPE_MAX_LINKS, artifactScopeOf } from './artifact-scope';

const id = (name: string) => name as AppSessionId;
const thread = (parent: string, openedBy: Lineage['openedBy'] = 'comment'): Lineage => ({ kind: 'side-thread', parentAppSessionId: id(parent), parentEngineSessionId: null, openedBy });
const fork = (parent: string): Lineage => ({ kind: 'fork', parentAppSessionId: id(parent), parentEngineSessionId: 'sid' as SessionId, openedBy: 'fork' });

// An index of records by id, each with the lineage given (null for a root); an id not named is missing.
const index = (lineages: Record<string, Lineage | null>) => ({
  get: (appId: AppSessionId) => (appId in lineages ? ({ appId, lineage: lineages[appId] } as unknown as SessionRecord) : null),
});

describe('artifactScopeOf', () => {
  it('answers [] for a root session and for a fork', () => {
    const sessions = index({ root: null, copy: fork('root') });
    expect(artifactScopeOf(sessions, null)).toEqual([]);
    expect(artifactScopeOf(sessions, fork('root'))).toEqual([]);
  });

  it('answers the parent for a comment thread and for a /btw-promoted thread', () => {
    const sessions = index({ root: null });
    expect(artifactScopeOf(sessions, thread('root'))).toEqual([id('root')]);
    expect(artifactScopeOf(sessions, thread('root', 'btw'))).toEqual([id('root')]);
  });

  it('answers the parent thread then the root for a thread of a thread', () => {
    const sessions = index({ root: null, t1: thread('root') });
    expect(artifactScopeOf(sessions, thread('t1'))).toEqual([id('t1'), id('root')]);
  });

  it("stops at a fork: a thread of a fork's side thread reaches that fork, never the fork's source", () => {
    const sessions = index({ source: null, copy: fork('source'), t1: thread('copy') });
    expect(artifactScopeOf(sessions, thread('t1'))).toEqual([id('t1'), id('copy')]);
  });

  it('a parent missing from the index ends the chain with the last one found', () => {
    expect(artifactScopeOf(index({}), thread('gone'))).toEqual([id('gone')]);
    expect(artifactScopeOf(index({ t1: thread('gone') }), thread('t1'))).toEqual([id('t1'), id('gone')]);
  });

  it('an index that cannot be read ends the chain there', () => {
    const throwing = { get: (): SessionRecord | null => { throw new Error('index closed'); } };
    expect(artifactScopeOf(throwing, thread('root'))).toEqual([id('root')]);
  });

  it('stops at a repeated id and after the link cap', () => {
    const cycle = index({ a: thread('b'), b: thread('a') });
    expect(artifactScopeOf(cycle, thread('a'))).toEqual([id('a'), id('b')]);
    const lineages: Record<string, Lineage | null> = {};
    for (let k = 0; k < 40; k++) lineages[`s${k}`] = thread(`s${k + 1}`);
    const chain = artifactScopeOf(index(lineages), thread('s0'));
    expect(ARTIFACT_SCOPE_MAX_LINKS).toBe(16);
    expect(chain).toEqual(Array.from({ length: 16 }, (_, k) => id(`s${k}`)));
  });
});

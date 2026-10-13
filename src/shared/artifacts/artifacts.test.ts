import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '../graph/ids';
import { ActorSchema, AUTHOR_COLORS, actorDisplay, actorKey, type Actor } from './actor';
import { ARTIFACT_KINDS, ArtifactSchema, ArtifactSessionLinkSchema, BYTE_KINDS, isDocKind, SpaceSchema, Y_DOC_KINDS } from './entity';
import { ArtifactVersionSchema } from './version';

const session = (id: string): Actor => ({ kind: 'session', appSessionId: id as AppSessionId });
const ID = '3f2b8a1c-5d4e-4f6a-8b7c-9d0e1f2a3b4c';
const SPACE = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

describe('the artifact entity (X23)', () => {
  const artifact = {
    id: ID,
    kind: 'document',
    title: 'Quarterly plan',
    createdBy: { kind: 'human' },
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_100_000,
    lastViewedAt: null,
    pinned: false,
  };

  it('parses an artifact with only its required fields, and with every optional one', () => {
    expect(ArtifactSchema.parse(artifact)).toEqual(artifact);
    const full = { ...artifact, handle: 'report', spaceId: SPACE, projectId: 'proj-1', designSystemId: ID, linkedPath: '/tmp/a.pdf', lastViewedAt: 1 };
    expect(ArtifactSchema.parse(full)).toEqual(full);
  });

  it('refuses an unknown kind, a non-UUID id, a handle outside the old tool’s id grammar, and an unknown key', () => {
    expect(ArtifactSchema.safeParse({ ...artifact, kind: 'spreadsheet' }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...artifact, id: 'report' }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...artifact, handle: '../escape' }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ ...artifact, deletedAt: 5 }).success).toBe(false);
  });

  it('splits the seven kinds into Y.Doc kinds and byte kinds (Decision Log 2)', () => {
    expect([...Y_DOC_KINDS, ...BYTE_KINDS].sort()).toEqual([...ARTIFACT_KINDS].sort());
    expect(BYTE_KINDS).toEqual(['html', 'file']);
    expect(ARTIFACT_KINDS.filter(isDocKind)).toEqual(Y_DOC_KINDS);
  });

  it('parses a space and a session link', () => {
    expect(SpaceSchema.parse({ id: SPACE, name: 'Teaching', createdAt: 1 })).toMatchObject({ name: 'Teaching' });
    expect(SpaceSchema.parse({ id: SPACE, name: 'Repo', linkedDir: '/Users/x/repo', createdAt: 1 }).linkedDir).toBe('/Users/x/repo');
    const link = { artifactId: ID, appSessionId: 'app-1', role: 'edited', lastAt: 2 };
    expect(ArtifactSessionLinkSchema.parse(link)).toEqual(link);
    expect(ArtifactSessionLinkSchema.safeParse({ ...link, role: 'owner' }).success).toBe(false);
  });
});

describe('actors (X29)', () => {
  it('parses the two actors and nothing else', () => {
    expect(ActorSchema.parse({ kind: 'human' })).toEqual({ kind: 'human' });
    expect(ActorSchema.parse({ kind: 'session', appSessionId: 'app-1' })).toEqual({ kind: 'session', appSessionId: 'app-1' });
    expect(ActorSchema.safeParse({ kind: 'session' }).success).toBe(false);
    expect(ActorSchema.safeParse({ kind: 'agent', appSessionId: 'app-1' }).success).toBe(false);
  });

  it('keys an actor stably and distinctly', () => {
    expect(actorKey({ kind: 'human' })).toBe('human');
    expect(actorKey(session('app-1'))).toBe('session:app-1');
    expect(actorKey(session('app-1'))).not.toBe(actorKey(session('app-2')));
  });

  it('names the human "You" and a session by its title, else "Claude"', () => {
    expect(actorDisplay({ kind: 'human' }).name).toBe('You');
    expect(actorDisplay({ kind: 'human' }, 'ignored').name).toBe('You');
    expect(actorDisplay(session('app-1'), 'Fix the build').name).toBe('Fix the build');
    expect(actorDisplay(session('app-1')).name).toBe('Claude');
    expect(actorDisplay(session('app-1'), '   ').name).toBe('Claude');
  });

  it('colours an actor by a stable hash of its key into eight token names, never a literal colour', () => {
    expect(AUTHOR_COLORS).toHaveLength(8);
    for (const color of AUTHOR_COLORS) expect(color).toMatch(/^--[a-z0-9-]+$/);
    const a = session('app-1');
    expect(actorDisplay(a).color).toBe(actorDisplay(a, 'renamed').color);
    expect(AUTHOR_COLORS).toContain(actorDisplay({ kind: 'human' }).color);
    const used = new Set(Array.from({ length: 64 }, (_, i) => actorDisplay(session(`session-${i}`)).color));
    expect(used.size).toBeGreaterThanOrEqual(6); // spread, not bunched
  });
});

describe('the version record (X29)', () => {
  it('parses each kind of version, with its pins', () => {
    const version = { id: 4, seq: 120, at: 3, actor: { kind: 'human' }, kind: 'named', label: 'Sent to the board', assetRefs: [] };
    expect(ArtifactVersionSchema.parse(version)).toEqual(version);
    const pinned = { ...version, kind: 'turn', actor: { kind: 'session', appSessionId: 'app-1' }, summary: '3 edits', designSystemRef: { id: ID, versionSeq: 88 }, assetRefs: ['a1'] };
    expect(ArtifactVersionSchema.parse(pinned)).toEqual(pinned);
    for (const kind of ['auto', 'turn', 'named', 'restore', 'import']) expect(ArtifactVersionSchema.safeParse({ ...version, kind }).success).toBe(true);
    expect(ArtifactVersionSchema.safeParse({ ...version, kind: 'manual' }).success).toBe(false);
  });
});

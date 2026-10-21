import { describe, expect, it } from 'vitest';
import { artifactLink, ArtifactLocationSchema, parseArtifactLink } from './link';

const ID = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('the maws-artifact link grammar', () => {
  it('reads a bare link as the artifact, with no place', () => {
    expect(parseArtifactLink(`maws-artifact:${ID}`)).toEqual({ artifactId: ID });
    expect(parseArtifactLink(`MAWS-ARTIFACT:${ID.toUpperCase()}`)).toEqual({ artifactId: ID }); // the id as the store holds it
  });

  it('round-trips every part, written in order and joined by #', () => {
    const at = { version: 3, tab: 'tab_1', block: 'b7k2m9qx', slide: 's-02' };
    const href = artifactLink(ID, at);
    expect(href).toBe(`maws-artifact:${ID}#v3#tab=tab_1#block=b7k2m9qx#slide=s-02`);
    expect(parseArtifactLink(href)).toEqual({ artifactId: ID, at });
    expect(artifactLink(ID, { slide: 's1', version: 12 })).toBe(`maws-artifact:${ID}#v12#slide=s1`);
    for (const one of [{ version: 1 }, { tab: 't' }, { block: 'b' }, { slide: 's' }]) expect(parseArtifactLink(artifactLink(ID, one))).toEqual({ artifactId: ID, at: one });
    expect(artifactLink(ID)).toBe(`maws-artifact:${ID}`);
    expect(artifactLink(ID, {})).toBe(`maws-artifact:${ID}`);
  });

  it('takes # or & between parts, in any order', () => {
    expect(parseArtifactLink(`maws-artifact:${ID}#tab=t1&block=b2`)).toEqual({ artifactId: ID, at: { tab: 't1', block: 'b2' } });
    expect(parseArtifactLink(`maws-artifact:${ID}#block=b2&v4#tab=t1`)).toEqual({ artifactId: ID, at: { version: 4, tab: 't1', block: 'b2' } });
    expect(parseArtifactLink(`maws-artifact:${ID}&block=b2`)).toEqual({ artifactId: ID, at: { block: 'b2' } });
  });

  it('reads the content form as the artifact; a fragment after its path is the page’s own', () => {
    expect(parseArtifactLink(`maws-artifact://${ID}/live/index.html`)).toEqual({ artifactId: ID });
    expect(parseArtifactLink(`maws-artifact://${ID}/3/index.html#block=b2`)).toEqual({ artifactId: ID });
    expect(parseArtifactLink(`maws-artifact://${ID}#block=b2`)).toEqual({ artifactId: ID, at: { block: 'b2' } });
    expect(parseArtifactLink(`maws-artifact:${ID}?v=3`)).toEqual({ artifactId: ID });
  });

  it('drops a part it cannot read, and the link still opens the artifact', () => {
    for (const junk of ['v0', 'v-1', 'vx', 'v', 'v1.5', 'v03', 'v1234567890', 'tab=', 'block=a b', `block=${'x'.repeat(65)}`, 'slide=a/b', 'foo=bar', 'tab', '', 'Block=b1', 'block=b%201']) {
      expect(parseArtifactLink(`maws-artifact:${ID}#${junk}`), junk).toEqual({ artifactId: ID });
      expect(parseArtifactLink(`maws-artifact:${ID}#${junk}#tab=t1`), junk).toEqual({ artifactId: ID, at: { tab: 't1' } });
    }
    expect(parseArtifactLink(`maws-artifact:${ID}#block=${'x'.repeat(64)}`)).toEqual({ artifactId: ID, at: { block: 'x'.repeat(64) } });
  });

  it('keeps the first of a part written twice', () => {
    expect(parseArtifactLink(`maws-artifact:${ID}#block=b1#block=b2#v2#v3`)).toEqual({ artifactId: ID, at: { block: 'b1', version: 2 } });
  });

  it('is null for anything that names no artifact by its store id', () => {
    for (const href of ['maws-artifact:', 'maws-artifact:roadmap', 'maws-artifact:roadmap#block=b1', `maws-artifact:${ID}x`, `https://example.com/${ID}`, ID, `maws-path:${ID}`, `maws-artifact:/${ID}`]) {
      expect(parseArtifactLink(href), href).toBeNull();
    }
  });
});

describe('ArtifactLocationSchema: a place, as show_pane takes it', () => {
  it('is strict, with the link’s ids and a positive version', () => {
    expect(ArtifactLocationSchema.parse({ block: 'b1' })).toEqual({ block: 'b1' });
    expect(ArtifactLocationSchema.safeParse({ version: 2, tab: 't1', block: 'b1', slide: 's1' }).success).toBe(true);
    expect(ArtifactLocationSchema.safeParse({}).success).toBe(true);
    for (const bad of [{ version: 0 }, { version: 1.5 }, { tab: '' }, { block: 'a b' }, { slide: 'x'.repeat(65) }, { line: 3 }]) {
      expect(ArtifactLocationSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

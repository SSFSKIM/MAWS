import { describe, expect, it } from 'vitest';
import { artifactUrl, parseArtifactUrl } from './scheme';

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

describe('maws-artifact: URLs (Decision Log 14)', () => {
  it('round-trips a content file and an asset, live and at a revision, each segment encoded', () => {
    expect(artifactUrl(ID, 'live', 'index.html')).toBe(`maws-artifact://${ID}/live/index.html`);
    expect(artifactUrl(ID, 12, 'assets/a b#1.png')).toBe(`maws-artifact://${ID}/12/assets/a%20b%231.png`);
    expect(parseArtifactUrl(artifactUrl(ID, 12, 'assets/a b#1.png'))).toEqual({ artifactId: ID, revision: 12, path: 'assets/a b#1.png' });
    expect(parseArtifactUrl(`maws-artifact://${ID}/live/index.html?x=1#top`)).toEqual({ artifactId: ID, revision: 'live', path: 'index.html' });
    expect(parseArtifactUrl(`maws-artifact://${ID.toUpperCase()}/0/index.html`)).toEqual({ artifactId: ID, revision: 0, path: 'index.html' });
  });

  it('refuses traversal, empty and encoded-slash segments, a revision that is not one, an id that is not a uuid, another scheme', () => {
    for (const url of [
      `maws-artifact://${ID}/live/../store.sqlite`,
      `maws-artifact://${ID}/live/%2e%2e/store.sqlite`,
      `maws-artifact://${ID}/live/assets/..%2F..%2Fstore.sqlite`,
      `maws-artifact://${ID}/live/assets%2Fa.png`,
      `maws-artifact://${ID}/live/assets//a.png`,
      `maws-artifact://${ID}/live/a%5Cb`,
      `maws-artifact://${ID}/live/a%00b`,
      `maws-artifact://${ID}/live/%E0%A4%A`,
      `maws-artifact://${ID}/live/`,
      `maws-artifact://${ID}/01/index.html`,
      `maws-artifact://${ID}/-1/index.html`,
      `maws-artifact://${ID}/latest/index.html`,
      `maws-artifact://${ID}/99999999999999999999/index.html`,
      'maws-artifact://report/live/index.html',
      `maws-deliverable://${ID}/live/index.html`,
      `maws-artifact://${ID}/live/${'a'.repeat(1_001)}`,
    ]) {
      expect(parseArtifactUrl(url), url).toBeNull();
    }
  });
});

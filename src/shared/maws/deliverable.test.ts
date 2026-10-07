import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '../graph/ids';
import { DELIVERABLE_SCHEME, DeliverableRecordSchema, deliverableUrl, parseDeliverableUrl } from './deliverable';

it("X12: a delivered file's record is strict, with a uuid id and its versions", () => {
  const record = { id: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', appSessionId: 'app-1', kind: 'file', path: '/r/hello.txt', title: 'hello.txt', caption: 'the greeting', versions: [{ path: '/r/hello.txt', at: '2026-10-05T00:00:00.000Z' }], toolUseId: 'toolu_1', createdAt: '2026-10-05T00:00:00.000Z' };
  expect(DeliverableRecordSchema.parse(record)).toEqual(record);
  const { title: _t, caption: _c, toolUseId: _u, ...minimal } = record;
  void [_t, _c, _u];
  expect(DeliverableRecordSchema.safeParse(minimal).success).toBe(true);
  expect(DeliverableRecordSchema.safeParse({ ...record, id: 'd1' }).success).toBe(false);
  expect(DeliverableRecordSchema.safeParse({ ...record, kind: 'note' }).success).toBe(false);
  expect(DeliverableRecordSchema.safeParse({ ...record, urgency: 'high' }).success).toBe(false);
});

// E2 start (E2 execution document, Design §2 and §3)
describe('X12 as E2 extends it', () => {
  const ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

  it("an artifact's record carries its id, the last version's time and each version's call and source, all optional", () => {
    const artifact = {
      id: ID, appSessionId: 'app-1', kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: `/u/deliverables/app-1/${ID}/v2.html`,
      versions: [
        { path: `/u/deliverables/app-1/${ID}/v1.html`, at: '2026-10-06T00:00:00.000Z', toolUseId: 'toolu_1', sourcePath: '/r/dashboard.html' },
        { path: `/u/deliverables/app-1/${ID}/v2.html`, at: '2026-10-06T00:01:00.000Z', sourcePath: '/r/dashboard.html' },
      ],
      toolUseId: 'toolu_1', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:01:00.000Z',
    };
    expect(DeliverableRecordSchema.parse(artifact)).toEqual(artifact);
    expect(DeliverableRecordSchema.safeParse({ ...artifact, artifactId: '/x' }).success).toBe(false);
    expect(DeliverableRecordSchema.safeParse({ ...artifact, versions: [{ path: '/p', at: 'now', extra: 1 }] }).success).toBe(false);
  });

  it('builds the scheme URL from the record uuid, the app session id and the version, and parses it back', () => {
    expect(DELIVERABLE_SCHEME).toBe('maws-deliverable');
    expect(deliverableUrl('app-1' as AppSessionId, ID, 2)).toBe(`maws-deliverable://${ID}/app-1/2`);
    expect(parseDeliverableUrl(`maws-deliverable://${ID}/app-1/2`)).toEqual({ appSessionId: 'app-1', id: ID, version: 2 });
    // an app session id may carry uppercase (app-session-id.ts), so it is a path segment, never the host
    expect(parseDeliverableUrl(deliverableUrl('App-Session.42' as AppSessionId, ID, 1))).toEqual({ appSessionId: 'App-Session.42', id: ID, version: 1 });
    // a frame that moved to its own fragment, or a query, is still the same deliverable
    expect(parseDeliverableUrl(`maws-deliverable://${ID}/app-1/3#section`)).toEqual({ appSessionId: 'app-1', id: ID, version: 3 });
    expect(parseDeliverableUrl(`maws-deliverable://${ID}/app-1/3?x=1`)).toEqual({ appSessionId: 'app-1', id: ID, version: 3 });
  });

  it('answers null for a bad host, a bad version, a wrong shape or a wrong scheme', () => {
    for (const url of [
      'maws-deliverable://not-a-uuid/app-1/1',
      `maws-deliverable://${ID}/app-1/1.5`,
      `maws-deliverable://${ID}/app-1/0`,
      `maws-deliverable://${ID}/app-1/01`,
      `maws-deliverable://${ID}/app-1/x`,
      `maws-deliverable://${ID}/app-1/99999999999999999999`,
      `maws-deliverable://${ID}/app-1`,
      `maws-deliverable://${ID}/app-1/1/extra`,
      `maws-deliverable://${ID}//1`,
      `https://${ID}/app-1/1`,
      `file:///${ID}/app-1/1`,
      '',
    ]) {
      expect(parseDeliverableUrl(url), url).toBeNull();
    }
  });
});
// E2 end
// E4c start (E4c execution document, Design §7; X12's additive `sourceUrl`)
describe('X12 as E4c extends it', () => {
  it("a screenshot's record carries the page's URL, optional and never rewritten", () => {
    const ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
    const shot = {
      id: ID, appSessionId: 'app-1', kind: 'screenshot', title: 'E4c order form', path: `/u/deliverables/app-1/screenshots/${ID}.png`, sourceUrl: 'http://127.0.0.1:17391/form.html',
      versions: [{ path: `/u/deliverables/app-1/screenshots/${ID}.png`, at: '2026-10-07T00:00:00.000Z', toolUseId: 'toolu_1' }], toolUseId: 'toolu_1', createdAt: '2026-10-07T00:00:00.000Z',
    };
    expect(DeliverableRecordSchema.parse(shot)).toEqual(shot);
    expect(DeliverableRecordSchema.safeParse({ ...shot, sourceUrl: undefined }).success).toBe(true);
    for (const sourceUrl of ['about:blank', 'https://example.com/a?b#c']) expect(DeliverableRecordSchema.safeParse({ ...shot, sourceUrl }).success, sourceUrl).toBe(true);
    for (const sourceUrl of ['', 'not a url', ' http://example.com/']) expect(DeliverableRecordSchema.safeParse({ ...shot, sourceUrl }).success, sourceUrl).toBe(false);
  });
});
// E4c end

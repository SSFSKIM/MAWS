// P3-E (E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; E's Decision Log 28 (5)): a dashboard comment's
// lead, a fixed persisted wording for prose and chart blocks alike, `content "<locator>" in dashboard <id>`; the block's
// locator is the dashboard's `<view>: <caption or dataset id>`, so the agent reads the kind. The tag round-trips, and the
// lead is stripped only when it is the one this wording writes; every other kind's lead is as it was.
import { describe, expect, it } from 'vitest';
import type { Anchor } from './anchor';
import { anchorLead, anchoredMessage, anchorTag, parseAnchoredText } from './message';

const block: Anchor = { kind: 'artifact-comment', label: 'Growth board, Main', locator: 'chart: Sales by region', artifactId: 'art-d1', threadId: 'k2m9x0qa', artifactKind: 'dashboard' };
const prose: Anchor = { ...block, locator: 'rose in every region' };

describe('a dashboard comment’s lead (P3-E)', () => {
  it('names the content and the dashboard, for a chart block and for prose alike', () => {
    expect(anchorLead(block, false)).toBe('Comment on "Growth board, Main" (content "chart: Sales by region" in dashboard art-d1, thread k2m9x0qa):');
    expect(anchorLead(prose, false)).toBe('Comment on "Growth board, Main" (content "rose in every region" in dashboard art-d1, thread k2m9x0qa):');
    expect(anchorLead(block, true)).toBe('Comment on "Growth board, Main" (content "chart: Sales by region" in dashboard art-d1, thread k2m9x0qa). A screenshot of it is attached:');
  });

  it('round-trips through the tag, the lead stripped', () => {
    expect(anchorTag(block)).toBe('<maws_anchor kind="artifact-comment" label="Growth board, Main" locator="chart: Sales by region" artifactId="art-d1" threadId="k2m9x0qa" artifactKind="dashboard"/>');
    const message = anchoredMessage({ anchor: block, text: 'Why the dip in the west?', destination: 'main', screenshot: false });
    expect(message.split('\n')[0]).toBe(anchorLead(block, false));
    expect(parseAnchoredText(message)).toEqual({ anchor: block, text: 'Why the dip in the west?', destination: 'main' });
  });

  it('leaves the document’s and the presentation’s leads as they were', () => {
    expect(anchorLead({ ...block, artifactKind: 'document' }, false)).toBe('Comment on "Growth board, Main" (passage "chart: Sales by region" in document art-d1, thread k2m9x0qa):');
    expect(anchorLead({ ...block, artifactKind: undefined }, false)).toBe('Comment on "Growth board, Main" (passage "chart: Sales by region" in document art-d1, thread k2m9x0qa):');
    expect(anchorLead({ ...block, artifactKind: 'presentation' }, false)).toBe('Comment on "Growth board, Main" (element "chart: Sales by region" in presentation art-d1, thread k2m9x0qa):');
  });
});

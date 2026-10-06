// E2 (M6): the picker's messages and the artifact-element anchor (Design §10). Every field of a picked message is the
// page's, and the title the agent's: the anchor carries X10's fields alone and passes E3's `AnchorSchema` whatever they
// hold (no control characters, the label at most 200 characters, the locator at most 2,000).
import { describe, expect, it } from 'vitest';
import { AnchorSchema } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { deliverableUrl, type DeliverableRecord } from '@shared/maws/deliverable';
import { artifactElementAnchor, parsePickMessage, type PickedMessage } from './pick';

const A = 'App-A' as AppSessionId;
const ID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const record = (title: string | undefined): DeliverableRecord => ({
  id: ID, appSessionId: A, kind: 'artifact', artifactId: 'dash', ...(title === undefined ? {} : { title }), path: '/u/v2.html',
  versions: [{ path: '/u/v1.html', at: 't' }, { path: '/u/v2.html', at: 't' }], createdAt: 't', updatedAt: 't',
});
const picked = (over: Partial<PickedMessage> = {}): PickedMessage => ({
  type: 'maws:picked', selector: '#hero > h1:nth-of-type(1)', label: 'h1.title', text: 'Sales overview', rect: { x: 1, y: 2, width: 3, height: 4 }, ...over,
});

describe('parsePickMessage', () => {
  it('reads the two shapes the bridge script posts, and nothing else', () => {
    expect(parsePickMessage(picked())).toEqual(picked());
    expect(parsePickMessage({ type: 'maws:pick-cancelled' })).toEqual({ type: 'maws:pick-cancelled' });
    expect(parsePickMessage({ type: 'maws:pick', on: true })).toBeNull(); // the app's own message, echoed
    expect(parsePickMessage({ ...picked(), selector: 7 })).toBeNull();
    expect(parsePickMessage({ type: 'maws:picked', selector: 'p' })).toBeNull();
    expect(parsePickMessage('maws:picked')).toBeNull();
    expect(parsePickMessage(null)).toBeNull();
  });
});

describe('artifactElementAnchor (X10 artifact-element)', () => {
  it('names the element on the artifact’s version: locator, label and the scheme URL, X10’s fields alone', () => {
    const anchor = artifactElementAnchor(record('Dashboard'), 2, picked());
    expect(anchor).toEqual({
      kind: 'artifact-element',
      locator: '#hero > h1:nth-of-type(1)',
      label: 'Dashboard v2 › h1.title “Sales overview”',
      pageUrl: deliverableUrl(A, ID, 2),
    });
    expect(AnchorSchema.parse(anchor)).toEqual(anchor);
  });

  it('cuts the element’s text to 40 characters and an element with no text shows its tag alone', () => {
    const anchor = artifactElementAnchor(record('Dashboard'), 1, picked({ text: 'x'.repeat(2_000) }));
    const quoted = /“(.*)”$/.exec(anchor.label)![1]!;
    expect(quoted).toHaveLength(40);
    expect(quoted.endsWith('…')).toBe(true);
    expect(artifactElementAnchor(record('Dashboard'), 1, picked({ text: '' })).label).toBe('Dashboard v1 › h1.title');
  });

  it('keeps the label to 200 characters even for a long title and a long id, and keeps the element in it', () => {
    const anchor = artifactElementAnchor(record('T'.repeat(200)), 2, picked({ label: `div#${'i'.repeat(500)}`, text: 'y'.repeat(2_000) }));
    expect(anchor.label.length).toBeLessThanOrEqual(200);
    expect(anchor.label).toMatch(/^T+… v2 › div#i+… “y+…”$/);
    expect(AnchorSchema.safeParse(anchor).success).toBe(true);
  });

  it('makes every field one line: control characters in the title, the label, the text and the selector go', () => {
    const anchor = artifactElementAnchor(record('Dash\nboard\u0007'), 1, picked({ selector: 'body >\n p\u0000', label: 'p.a\tb', text: 'line one\r\nline\u001b two' }));
    expect(AnchorSchema.safeParse(anchor).success).toBe(true);
    expect(anchor.label).toBe('Dash board v1 › p.a b “line one line two”');
    expect(anchor.locator).toBe('body > p');
  });

  it('keeps the locator to 2,000 characters, and never splits a surrogate pair', () => {
    const anchor = artifactElementAnchor(record('😀'.repeat(150)), 1, picked({ selector: 'p'.repeat(5_000), text: `${'a'.repeat(38)}😀😀` }));
    expect(anchor.locator).toHaveLength(2_000);
    expect(AnchorSchema.safeParse(anchor).success).toBe(true);
    expect(anchor.label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('falls back to the version file’s name when the record has no title', () => {
    expect(artifactElementAnchor(record(undefined), 2, picked()).label).toBe('v2.html v2 › h1.title “Sales overview”');
  });
});

// The comment protocol's pure half (E4d execution document, Design §3, §6, §9): the label a pick shows and sends, and the
// preload's trim of a description to the report's caps, so a long page string never refuses a legitimate pick.
import { describe, expect, it } from 'vitest';
import {
  A11Y_SEGMENT_NAME_MAX,
  COMMENT_CHANNEL,
  COMMENT_NODES,
  COMMENT_WORDS,
  CSS_PATH_MAX,
  DRAG_THRESHOLD_PX,
  elementLabel,
  PICK_AT_MS,
  REPORT_A11Y_MAX,
  REPORT_NAME_MAX,
  REPORT_TOKEN_MAX,
  trimDescription,
} from './comment-protocol';
import type { ElementDescription } from './describe';

const description = (fields: Partial<ElementDescription>): ElementDescription => ({ css: '#x', role: 'button', name: 'Save', a11y: 'button “Save”', tag: 'button', confident: true, ...fields });

describe('elementLabel', () => {
  it('reads `<role> “<name>”` for E0b’s four targets', () => {
    expect(elementLabel({ role: 'button', name: 'Increment', tag: 'button' }, 200)).toBe('button “Increment”');
    expect(elementLabel({ role: 'button', name: 'Act', tag: 'button' }, 200)).toBe('button “Act”');
    expect(elementLabel({ role: 'textbox', name: 'Name', tag: 'input' }, 200)).toBe('textbox “Name”');
    expect(elementLabel({ role: 'link', name: 'local link', tag: 'a' }, 200)).toBe('link “local link”');
  });

  it('falls back to the tag without a role, and to the role or tag alone without a name', () => {
    expect(elementLabel({ role: null, name: '', tag: 'div' }, 200)).toBe('div');
    expect(elementLabel({ role: 'list', name: '', tag: 'ul' }, 200)).toBe('list');
    expect(elementLabel({ role: null, name: 'Frame title', tag: 'iframe' }, 200)).toBe('iframe “Frame title”');
  });

  it('cuts the name, never the role, to fit the bound', () => {
    const label = elementLabel({ role: 'button', name: 'n'.repeat(300), tag: 'button' }, 200);
    expect(label).toHaveLength(200);
    expect(label.startsWith('button “nnn')).toBe(true);
    expect(label.endsWith('n…”')).toBe(true);
    expect(elementLabel({ role: 'button', name: 'n'.repeat(60), tag: 'button' }, 40)).toBe(`button “${'n'.repeat(30)}…”`);
    expect(elementLabel({ role: null, name: 'x', tag: 't'.repeat(64) }, 40)).toBe(`${'t'.repeat(39)}…`);
  });
});

describe('trimDescription', () => {
  it('leaves a description within the caps as it is', () => {
    const within = description({ name: 'n'.repeat(REPORT_NAME_MAX), a11y: 'a'.repeat(REPORT_A11Y_MAX) });
    expect(trimDescription(within)).toEqual({ description: within, nameOverLong: false });
  });

  it('cuts a long name and flags it, and bounds the role, the tag and the path', () => {
    const { description: trimmed, nameOverLong } = trimDescription(description({ name: 'n'.repeat(250), role: 'r'.repeat(70), tag: 't'.repeat(70), a11y: `${'a'.repeat(350)}z` }));
    expect(nameOverLong).toBe(true);
    expect(trimmed.name).toHaveLength(REPORT_NAME_MAX);
    expect(trimmed.name.endsWith('…')).toBe(true);
    expect(trimmed.role).toHaveLength(REPORT_TOKEN_MAX);
    expect(trimmed.tag).toHaveLength(REPORT_TOKEN_MAX);
    expect(trimmed.a11y).toHaveLength(REPORT_A11Y_MAX);
    expect(trimmed.a11y.startsWith('…') && trimmed.a11y.endsWith('z')).toBe(true); // the innermost segments are kept
    expect(trimmed.css).toBe('#x');
    expect(trimDescription(description({ role: null })).description.role).toBeNull();
  });
});

describe('the protocol’s names and bounds', () => {
  it('are the ledger’s and the design’s', () => {
    expect(COMMENT_CHANNEL).toEqual({ toPreload: 'browser:preload:comment', fromPreload: 'browser:preload:pick' });
    expect(COMMENT_NODES).toEqual({ shield: 'maws-comment-shield', overlay: 'maws-comment-overlay', badge: 'maws-comment-badge', marker: 'data-maws-comment' });
    expect(COMMENT_WORDS).toEqual({ menu: 'Comment', hint: 'Click to comment · drag for an area · Esc leaves' });
    expect([REPORT_NAME_MAX, REPORT_A11Y_MAX, A11Y_SEGMENT_NAME_MAX, REPORT_TOKEN_MAX, CSS_PATH_MAX, DRAG_THRESHOLD_PX, PICK_AT_MS]).toEqual([200, 300, 40, 64, 2000, 6, 2000]);
  });
});

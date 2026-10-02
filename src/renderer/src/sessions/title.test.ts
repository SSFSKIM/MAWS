import { describe, expect, it } from 'vitest';
import { displayTitle, NEW_CHAT } from './title';

describe('displayTitle (W11, I1)', () => {
  it('reads the title, and "New chat" for an empty or blank title and for no record', () => {
    expect(displayTitle({ title: { text: 'Fix the drag handle', source: 'none' } })).toBe('Fix the drag handle');
    expect(displayTitle({ title: { text: '', source: 'none' } })).toBe(NEW_CHAT);
    expect(displayTitle({ title: { text: '  ', source: 'user' } })).toBe(NEW_CHAT);
    expect(displayTitle(undefined)).toBe('New chat');
    expect(displayTitle(null)).toBe('New chat');
  });
});

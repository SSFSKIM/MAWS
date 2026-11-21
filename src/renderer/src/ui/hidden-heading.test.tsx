// The hidden heading (the word cut, "What the cut builds"): cut from view where the tab or the sidebar row already
// names the place, and still in the document for assistive technology.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HiddenHeading } from './hidden-heading';

afterEach(cleanup);

describe('HiddenHeading', () => {
  it('is a heading of its level by name, drawn with the screen-reader-only class', () => {
    render(
      <section aria-labelledby="settings-title">
        <HiddenHeading level={2} id="settings-title">
          Settings
        </HiddenHeading>
      </section>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Settings' });
    expect(heading.className).toBe('sr-only');
    expect(screen.getByRole('region', { name: 'Settings' })).toBeTruthy();
  });
});

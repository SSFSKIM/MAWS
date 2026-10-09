// The library's My items | Browse switch (P2-B execution document §5.8): a click on the other view switches to it, and a
// click on the view already shown is reported as that view (Radix's single toggle group emits an empty value for it),
// so the widget can return that view from its detail to its list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibrarySwitch, SearchField } from './LibraryHeader';

afterEach(cleanup);

describe('LibrarySwitch', () => {
  it('reports the other view on its click, and the current view on a click of the view shown', () => {
    const onChange = vi.fn();
    render(<LibrarySwitch tab="browse" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Browse' }));
    expect(onChange).toHaveBeenLastCalledWith('browse');
    fireEvent.click(screen.getByRole('radio', { name: 'My items' }));
    expect(onChange).toHaveBeenLastCalledWith('myItems');
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

// P2-B M6: an Escape an input method is composing with (a Korean syllable in progress) cancels the composition only;
// the field keeps its text, as the dialog stays (WidgetDialog's host).
describe('SearchField', () => {
  it('clears its text on Escape, but not on an Escape that ends a composition', () => {
    const onChange = vi.fn();
    render(<SearchField label="Search skills" value="한" onChange={onChange} />);
    const field = screen.getByRole('searchbox', { name: 'Search skills' });
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('');
  });
});

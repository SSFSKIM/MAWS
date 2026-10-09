// The library's My items | Browse switch (P2-B execution document §5.8): a click on the other view switches to it, and a
// click on the view already shown is reported as that view (Radix's single toggle group emits an empty value for it),
// so the widget can return that view from its detail to its list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibrarySwitch } from './LibraryHeader';

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

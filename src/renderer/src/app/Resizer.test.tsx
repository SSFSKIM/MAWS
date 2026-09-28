import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Resizer } from './Resizer';

// A region whose width the resizer drives, as the shell does with the layout store.
function Harness({ grow = 1, initial = 300 }: { grow?: 1 | -1; initial?: number }) {
  const [width, setWidth] = useState(initial);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div>
      <output data-testid="state">{collapsed ? 'collapsed' : width}</output>
      {!collapsed && (
        <Resizer
          label="Resize sidebar"
          controls="region-sidebar"
          value={width}
          min={200}
          max={480}
          defaultValue={300}
          grow={grow}
          collapseThreshold={40}
          onChange={setWidth}
          onCollapse={() => setCollapsed(true)}
        />
      )}
    </div>
  );
}

const state = () => screen.getByTestId('state').textContent;
const separator = () => screen.getByRole('separator', { name: 'Resize sidebar' });

async function focused(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  await user.tab();
  expect(separator()).toHaveProperty('tagName', 'DIV');
  expect(document.activeElement).toBe(separator());
  return user;
}

function drag(from: number, ...to: number[]) {
  const handle = separator();
  act(() => void fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: from }));
  for (const x of to) act(() => void fireEvent.pointerMove(handle, { pointerId: 1, clientX: x }));
}
const release = (x: number) => act(() => void fireEvent.pointerUp(separator(), { pointerId: 1, clientX: x }));

describe('resizer', () => {
  afterEach(cleanup);

  it('is a focusable vertical ARIA separator reporting its value and bounds', () => {
    render(<Harness />);
    const el = separator();
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-orientation')).toBe('vertical');
    expect(el.getAttribute('aria-controls')).toBe('region-sidebar');
    expect([el.getAttribute('aria-valuenow'), el.getAttribute('aria-valuemin'), el.getAttribute('aria-valuemax')]).toEqual(['300', '200', '480']);
  });

  it('moves 8 px per arrow and 32 px with Shift, and clamps at both bounds', async () => {
    const user = await focused();
    await user.keyboard('{ArrowRight}');
    expect(state()).toBe('308');
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(state()).toBe('276');
    for (let i = 0; i < 20; i++) await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(state()).toBe('480');
    for (let i = 0; i < 20; i++) await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(state()).toBe('200'); // the keyboard clamps; it never collapses
    expect(separator().getAttribute('aria-valuenow')).toBe('200');
  });

  it('Home and End set the extremes and Enter restores the default', async () => {
    const user = await focused();
    await user.keyboard('{End}');
    expect(state()).toBe('480');
    await user.keyboard('{Home}');
    expect(state()).toBe('200');
    await user.keyboard('{Enter}');
    expect(state()).toBe('300');
  });

  it('a double-click restores the default', async () => {
    const user = await focused({ initial: 420 });
    await user.dblClick(separator());
    expect(state()).toBe('300');
  });

  it('grows the other way for a region on the right', async () => {
    const user = await focused({ grow: -1 });
    await user.keyboard('{ArrowLeft}');
    expect(state()).toBe('308');
    drag(500, 450);
    expect(state()).toBe('358');
    release(450);
  });

  it('follows a pointer drag and clamps it at both bounds', () => {
    render(<Harness />);
    drag(300, 340);
    expect(state()).toBe('340');
    drag(300, 900);
    expect(state()).toBe('480');
    release(900);
    drag(480, 470);
    expect(state()).toBe('470');
    release(470);
    // Moving without a press does nothing.
    act(() => void fireEvent.pointerMove(separator(), { pointerId: 1, clientX: 100 }));
    expect(state()).toBe('470');
  });

  it('a drag released less than 40 px past the minimum snaps back to the minimum', () => {
    render(<Harness />);
    drag(300, 250, 200, 161); // raw width 161: 39 px under the 200 minimum
    expect(state()).toBe('200');
    release(161);
    expect(state()).toBe('200');
  });

  it('a drag 40 px past the minimum collapses the region', () => {
    render(<Harness />);
    drag(300, 250, 160);
    expect(state()).toBe('collapsed');
  });
});

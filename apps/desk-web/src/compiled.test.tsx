// @vitest-environment happy-dom
// The suites run the code the desk ships: vitest.config.ts builds them under the React Compiler, as vite.config.ts
// builds the app (and electron.vite.config.ts MAWS's renderer). Compiled, a component keeps an element whose inputs did
// not change, so the child renders once while its parent renders twice; built plain, it renders with its parent.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

function Child({ onRender }: { onRender: () => void }) {
  onRender();
  return null;
}

function Parent({ onRender }: { onRender: () => void }) {
  const [count, setCount] = useState(0);
  return (
    <>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      <Child onRender={onRender} />
    </>
  );
}

afterEach(cleanup);

it('builds the suites under the React Compiler: an unchanged element is kept across its parent’s render', () => {
  const onRender = vi.fn();
  render(<Parent onRender={onRender} />);
  fireEvent.click(screen.getByRole('button', { name: '0' }));
  expect(screen.getByRole('button', { name: '1' })).toBeTruthy();
  expect(onRender).toHaveBeenCalledTimes(1);
});

// One scrim for every modal layer (UX wave U11a, M3; board 523; the execution document's Interfaces §E): a sheet or a dialog
// dims the window with `SCRIM`, and where layers stack only the top one's backdrop paints, so the window behind is dimmed
// once however many are open. The top layer is the one mounted last; one that leaves hands the paint back to the layer
// under it. `Sheet` and the hand-drawn dialogs take their backdrop from here (`Backdrop` through Radix's `asChild`).
import { act, cleanup, render } from '@testing-library/react';
import { Dialog } from 'radix-ui';
import { afterEach, describe, expect, it } from 'vitest';
import { Backdrop, useScrim } from './scrim';
import { Sheet } from './Sheet';
import { SCRIM } from './ui';

const CLEAR = 'bg-transparent';

function Layer({ name }: { name: string }) {
  return <div data-layer={name} className={useScrim()} />;
}
/** The layers in the order they opened; each mounts in its own commit, as one dialog opens over another. */
function Layers({ open }: { open: readonly string[] }) {
  return open.map((name) => <Layer key={name} name={name} />);
}
const paint = (name: string) => document.querySelector(`[data-layer="${name}"]`)!.className;
const painting = () => [...document.querySelectorAll('[data-layer]')].filter((el) => el.className === SCRIM).map((el) => el.getAttribute('data-layer'));

afterEach(cleanup);

describe('useScrim', () => {
  it('paints one layer with the scrim', () => {
    render(<Layers open={['a']} />);
    expect(paint('a')).toBe(SCRIM);
  });

  it('paints the layer opened over another, clears the one under it, and paints that one again once the top leaves', () => {
    const view = render(<Layers open={['a']} />);
    view.rerender(<Layers open={['a', 'b']} />);
    expect([paint('a'), paint('b')]).toEqual([CLEAR, SCRIM]);
    view.rerender(<Layers open={['a']} />);
    expect(paint('a')).toBe(SCRIM);
  });

  it('paints only the top of three, and hands the paint down as each leaves', () => {
    const view = render(<Layers open={['a']} />);
    view.rerender(<Layers open={['a', 'b']} />);
    view.rerender(<Layers open={['a', 'b', 'c']} />);
    expect(painting()).toEqual(['c']);
    view.rerender(<Layers open={['a', 'b']} />);
    expect(painting()).toEqual(['b']);
    view.rerender(<Layers open={['a']} />);
    expect(painting()).toEqual(['a']);
  });

  it('keeps the top painting when a layer under it leaves first', () => {
    const view = render(<Layers open={['a']} />);
    view.rerender(<Layers open={['a', 'b']} />);
    view.rerender(<Layers open={['a', 'b', 'c']} />);
    view.rerender(<Layers open={['a', 'c']} />);
    expect([paint('a'), paint('c')]).toEqual([CLEAR, SCRIM]);
  });
});

describe('Backdrop', () => {
  function Dialogged({ open }: { open: boolean }) {
    return (
      <>
        <Layer name="under" />
        <Dialog.Root open={open}>
          <Dialog.Portal>
            <Dialog.Overlay asChild>
              <Backdrop data-test-backdrop="" className="fixed inset-0 z-40" />
            </Dialog.Overlay>
            <Dialog.Content aria-describedby={undefined}>
              <Dialog.Title>Over</Dialog.Title>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    );
  }

  it("is a layer exactly while its dialog is open: it keeps the dialog's classes, adds the scrim and is marked", () => {
    const view = render(<Dialogged open={false} />);
    expect(paint('under')).toBe(SCRIM);
    view.rerender(<Dialogged open />);
    const backdrop = document.querySelector<HTMLElement>('[data-test-backdrop]')!;
    expect(backdrop.hasAttribute('data-scrim')).toBe(true);
    expect(backdrop.className.split(' ')).toEqual(expect.arrayContaining(['fixed', 'inset-0', 'z-40', SCRIM]));
    expect(paint('under')).toBe(CLEAR);
    view.rerender(<Dialogged open={false} />);
    expect(document.querySelector('[data-test-backdrop]')).toBeNull();
    expect(paint('under')).toBe(SCRIM);
  });
});

describe('Sheet', () => {
  const sheet = (title: string) => (
    <Sheet title={title} onClose={() => {}}>
      <p>{title}</p>
    </Sheet>
  );
  const scrims = () => [...document.querySelectorAll<HTMLElement>('[data-sheet-scrim]')];

  it("dims the window with the scrim, marked for the e2e cases, and yields it to a sheet opened over it", () => {
    const view = render(<>{sheet('First')}</>);
    expect(scrims()).toHaveLength(1);
    expect(scrims()[0]!.classList.contains(SCRIM)).toBe(true);
    expect(scrims()[0]!.hasAttribute('data-scrim')).toBe(true);
    act(() => view.rerender(<>{sheet('First')}{sheet('Second')}</>));
    expect(scrims().map((el) => el.classList.contains(SCRIM))).toEqual([false, true]);
    expect(scrims()[0]!.classList.contains(CLEAR)).toBe(true);
    act(() => view.rerender(<>{sheet('First')}</>));
    expect(scrims()[0]!.classList.contains(SCRIM)).toBe(true);
  });
});

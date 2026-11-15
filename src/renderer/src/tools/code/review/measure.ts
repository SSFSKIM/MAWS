// The one seam through which the stack reads the page's layout (UX wave U5b, M3 and M4; the execution document's §F and
// M4's "Measures come through one seam the tests replace"): happy-dom lays nothing out, so a test replaces these and the
// stack's decisions follow the measures it gives: from the widths, the header's narrow form, Split's room, a rename's fit
// and the toolbar's lines (a width of 0 is a page not laid out yet, and every decision then takes its wide form); from
// the heights and offsets, what each section weighs, the band and the place (M4). The scroller's own `scrollTop`,
// `scrollHeight` and `clientHeight` are read off the element.
export const reviewLayout = {
  width(element: Element): number {
    return element.getBoundingClientRect().width;
  },
  // The room inside an element's padding and border: its width less both (0 while it is not laid out).
  contentWidth(element: Element): number {
    const box = reviewLayout.width(element);
    if (box <= 0) return 0;
    const style = getComputedStyle(element);
    const inset = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
    return Math.max(0, box - inset);
  },
  // An element's height as drawn (a section's header, a drawn body, a diff row).
  height(element: Element): number {
    return element.getBoundingClientRect().height;
  },
  // How far below the top of `container` an element's top is drawn (a diff row inside its body).
  offsetWithin(element: Element, container: Element): number {
    return element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  },
};

// Under this width a side shows fewer than about twenty characters of code in Split (D9): the View menu's Split is
// disabled there and a stack whose stored choice is Split draws Unified until it is wide again.
export const SPLIT_MIN_WIDTH = 480;


// The one seam through which the stack reads the page's layout (UX wave U5b, M3; the execution document's §F and M4's
// "Measures come through one seam the tests replace"): happy-dom lays nothing out, so a test replaces `width` and the
// stack's decisions (the header's narrow form, Split's room, a rename's fit, the toolbar's lines) follow the widths it
// gives. A width of 0 is a page not laid out yet, and every decision then takes its wide form.
export const reviewLayout = {
  width(element: Element): number {
    return element.getBoundingClientRect().width;
  },
};

// Under this width a side shows fewer than about twenty characters of code in Split (D9): the View menu's Split is
// disabled there and a stack whose stored choice is Split draws Unified until it is wide again.
export const SPLIT_MIN_WIDTH = 480;


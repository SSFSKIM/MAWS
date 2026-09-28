// The panes' DOM handles: each pane's element id, and moving real focus into a pane (its active tab), which is what
// pane-scoped chords follow (they bind to the element that holds focus, not to the remembered focused pane).
export const paneDomId = (index: 0 | 1) => `pane-${index}`;

export function focusPaneElement(index: 0 | 1): void {
  document.getElementById(paneDomId(index))?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
}

// The panes' DOM handles: each pane's element id, and moving real focus into a pane (its active tab), which is what
// pane-scoped chords follow (they bind to the element that holds focus, not to the remembered focused pane).
export const paneDomId = (index: 0 | 1) => `pane-${index}`;

// A pane with no tab (W5: closing the last tab leaves pane 0 empty) takes focus on its first enabled control, the
// empty pane's Overview, so focus stays inside the pane rather than falling to the page.
export function focusPaneElement(index: 0 | 1): void {
  const pane = document.getElementById(paneDomId(index));
  const target = pane?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? pane?.querySelector<HTMLElement>('[role="tabpanel"] button:not(:disabled)');
  target?.focus();
}

// Session info's groups as the word cut draws them (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M3 task 2): each
// group is a region named by its title whose heading is its disclosure button; only Permissions and Usage open at first,
// and a folded group's rows are not mounted, so a read of a row in Engine, Model, Gateway or Hooks and MCP unfolds its
// group first.
import { expect, type Locator } from '@playwright/test';

export type InfoGroup = 'Engine' | 'Model' | 'Gateway' | 'Permissions' | 'Usage' | 'Hooks and MCP' | 'Not available here';

// Opens one group of a Session info body (`[data-session-info]`), if it is folded, and returns its region.
export async function unfoldInfoGroup(info: Locator, group: InfoGroup): Promise<Locator> {
  const region = info.getByRole('region', { name: group, exact: true });
  const head = region.getByRole('heading').getByRole('button');
  await expect(head).toBeVisible();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  return region;
}

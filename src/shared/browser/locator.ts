// The browser locator (P1 spec §9 E4, "the shared locator module `src/shared/browser/locator.ts`"; E4c execution
// document, Interfaces and Decision Log 24, 28, 30, 32): the shape `{ css, role?, name? }` an element is named by when
// no snapshot ref names it, the target `browser_act` and `browser_screenshot` resolve and E4d's comment anchors carry
// (X10). Main resolves it css-first (Decision Log 30); E4d's naming side is `describe.ts`, never this module.
// E4c start
import * as z from 'zod';

export const BrowserLocatorSchema = z.strictObject({
  css: z.string().min(1).max(2000),
  role: z.string().min(1).max(64).optional(),
  name: z.string().max(500).optional(),
});
export type BrowserLocator = z.infer<typeof BrowserLocatorSchema>;

// A locator as the browser tools' texts name it: `{css: "#save", role: "button", name: "Save"}`, the fields it has in
// that order, each string JSON-quoted so a selector's own quotes stay readable.
export function locatorText(locator: BrowserLocator): string {
  const fields = [`css: ${JSON.stringify(locator.css)}`];
  if (locator.role !== undefined) fields.push(`role: ${JSON.stringify(locator.role)}`);
  if (locator.name !== undefined) fields.push(`name: ${JSON.stringify(locator.name)}`);
  return `{${fields.join(', ')}}`;
}

// An element by its accessible role and name, as a snapshot line reads (`button "Save"`); either part may be absent.
export function roleNameText(element: { role?: string; name?: string }): string {
  return [element.role, element.name ? JSON.stringify(element.name) : undefined].filter((part) => part !== undefined).join(' ');
}
// E4c end

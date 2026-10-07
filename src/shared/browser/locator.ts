// The browser locator (P1 spec §9 E4, A-37): what `browser_act` and `browser_screenshot` resolve, and what a
// `browser-element` anchor carries flat (X10's `css`, `role`, `name`). This file is E4c's: the schema and its resolution
// are E4c's (its execution document, Design §2 and §6; Decision Log 24). E4d's naming side is `describe.ts`.
import * as z from 'zod';

// E4d start: E4c's code had not landed when E4d needed the schema (E4d execution document, Constraints "A-37", Task 1.1),
// so this block mirrors E4c's Design §2 exactly; the architect resolves it to E4c's own block at landing.
export const BrowserLocatorSchema = z.strictObject({
  css: z.string().min(1).max(2000),
  role: z.string().min(1).max(64).optional(),
  name: z.string().max(500).optional(),
});
export type BrowserLocator = z.infer<typeof BrowserLocatorSchema>;
// E4d end

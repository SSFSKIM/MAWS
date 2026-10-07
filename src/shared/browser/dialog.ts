// How much of a page's dialog MAWS keeps when it answers one the person cannot see (E4c execution document, Decision Log
// 33, 35, 37 and 44; A-42): a tool result's `dialogs` and a never-placed tab's `dialogAnswered` notice. A leaf module, so
// the tools' results (`maws/browser.ts`) and E4a's notice schema (`ipc/schema/browser.ts`, which `maws/browser.ts`
// imports) name the same numbers without an import cycle.
export const BROWSER_DIALOGS_MAX = 10; // the dialogs one result reports, and the answered ones a hidden tab holds
export const BROWSER_DIALOG_MESSAGE_MAX_CHARS = 500; // a result's dialog message, as plain text
export const BROWSER_DIALOG_EXCERPT_MAX_CHARS = 200; // the notice's excerpt, as plain text

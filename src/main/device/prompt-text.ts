// The words a person confirms, as main renders them (step-up.ts's actions; P5 O8 M4b, a grant's prompt that grants.ts
// composes): each value as it is when it is a plain identifier, else as JSON with every invisible or reordering control
// escaped, so no value can forge another line or hide what it says. Electron-free, so a module that composes a prompt
// for the step-up module's signers doesn't load Electron.

// Line and paragraph separators, bidi embeddings, overrides and isolates, zero-width characters and the BOM: invisible,
// or able to reorder what is shown. JSON.stringify escapes only the C0 controls.
const INVISIBLE = /[\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
const escapeInvisible = (text: string) => text.replace(INVISIBLE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
/** Any value as JSON, its invisible controls escaped. */
export const json = (value: unknown) => escapeInvisible(JSON.stringify(value));
/** A plain identifier as it is; anything else as JSON. */
export const shown = (text: string) => (/^[A-Za-z0-9_.:/@-]+$/.test(text) ? text : json(text));

// Pasted content on the wire (C6 execution document, *Pasted content* under Derivation; C7's contract, C6-owned by the
// ordering ruling because C6 merges first). The terminal wraps a pasted block past its threshold in these tags before
// sending; the engine's own parser (`cli.pretty.js` `vmt`) recognises exactly this grammar. C6 extracts the blocks
// into text attachments when it derives the user row; C7 frames them on send and neutralises a typed `<pasted_content`.
export const PASTED_BLOCK = /\n{0,2}<pasted_content id="([0-9a-f]{4})">\n([\s\S]*?)\n<\/pasted_content id="\1">\n{0,2}/g;

// The n-th block's place in the user row's text.
export const pastedPlaceholder = (n: number, lines: number) => `[Pasted text #${n} +${lines} lines]`;
export const PASTED_PLACEHOLDER = /\[Pasted text #(\d+) \+\d+ lines\]/g;

// Frames a body the way the terminal does, for tests and C7's send path.
export const framePasted = (id: string, body: string) => `<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">`;

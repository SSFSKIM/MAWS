// The one escaping rule for text another party supplied (a hub's answer, a device id, a member's email), moved here from
// the hub's `deploy/admin.ts` (P5 O8 M4c) with `mintDisagrees`, whose words carry it: admin and the app print the same.

/**
 * A hub-supplied string as it may be printed: every character outside printable ASCII, and the backslash, written as an
 * escape. What the hub serves (a device id, a relying party, a member's email, its refusal's text) could otherwise carry
 * terminal controls or a line of its own that forge or hide what the owner compares before `y`.
 */
export const printable = (text: string) => text.replace(/[^\x20-\x5b\x5d-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

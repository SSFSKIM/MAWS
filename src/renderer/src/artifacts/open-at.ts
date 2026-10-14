// Which version of an artifact an open asks for (the P3-L document, M6b fix wave 2): the latest (followed as new ones
// land), the version a call wrote by its revision (a transcript row of a call whose answer named it: the stable
// identity, whatever thinning does to the history before it), or a version number from before revisions were named (a
// legacy anchor's or an older row's `n`: X12's on an imported page, the place otherwise; `placeOfNumber`).
export type ArtifactOpenAt = 'latest' | { revision: number } | { version: number };

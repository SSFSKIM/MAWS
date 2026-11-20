// The side threads' words that main produces and the renderer shows (UX wave U5a,
// docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Decision Log 52). Main refuses a side thread of several
// comments that this Mac's older MAWS service would open from the first one alone (src/main/machines/side-thread-peer.ts),
// and the card shows that refusal's message as it shows any failed send's. The sentence names the checkbox by the label
// the card draws, so the label lives here too and the renderer's copy (`SIDE_COPY.composer.main`) is this one.
export const SEND_TO_MAIN_LABEL = 'Send to main';

export const THREAD_FROM_ONE_COMMENT = `This Mac’s MAWS service is an older build, which opens a side thread from one comment only: tick “${SEND_TO_MAIN_LABEL}” to send these comments to the main conversation, or send them one at a time`;
// UX wave U5b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §I; decision 24): a side thread from
// a comment on a commit's diff, refused for this Mac's service when it is older than the reads (it would drop the commit).
// By construction nobody is shown it: a commit's diff is read only from a service that knows the field.
export const THREAD_ABOUT_A_COMMIT = `This Mac’s MAWS service is an older build, which cannot open a side thread about a commit: tick “${SEND_TO_MAIN_LABEL}” to send this comment to the main conversation`;

// The derived child fixture's tail, as its generator (`panel-child-fixture.ts`) measured it: `first`, the seq of the
// tail's first event (the `releaseTo` the e2e passes; C6's `seek` releases strictly below it); `batches`, three release
// counts covering the tail in order, the third running through the Bash call and its permission request; `rows`, the
// child's top-level row count after each batch. Recorded here, with no imports, so the e2e reads the numbers directly.
export const PANEL_CHILD_TAIL = {
  first: 333,
  batches: [80, 80, 83],
  rows: [46, 86, 128],
} as const;

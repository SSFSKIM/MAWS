// The words of the to-human view where MAWS draws it (the U2b execution document, Interfaces §D): the only place they
// are written, each exactly as the to-human mod draws it (read at 0.8.2, `to-human/hooks/mods/to-human.tsx`: the
// marks `UNFOLD` and `FOLD`, lines 563 and 564, set before their label as `control` sets them; the label of a closed
// run's line is `foldLabel`'s fallback under any advertisement, `folds.tsx` being quiet there; `'fold to report'`,
// line 1218). M2 adds the message's label, the switch and the rest.
export const RECORD = {
  closed: '› working record',
  open: '‹ fold to report',
} as const;

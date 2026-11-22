// The word cut's rule 5 for an action outside the transcript (P140's Tasks Open, T222's Open creating turn): drawn on the
// row or heading pointed at, or holding keyboard focus, and always where nothing can point (the touch rule). The scope
// is the row or heading; the action the control inside it. One unlayered rule in `styles/app.css` draws it, so no
// utility class can show it at rest and no script reads a media query; the transcript's own rows keep theirs in
// `transcript/view/transcript.css`. The action stays in the Tab order and keeps its name: it is only undrawn at rest.
export const HOVER_SCOPE = { 'data-hover-scope': '' } as const;
export const ON_HOVER = { 'data-on-hover': '' } as const;

// P4-B2 D19: the Google Fonts suites read the grounding's recorded answers as text (e2e/fixtures/google-fonts/): CSS2
// answers saved as `.css.txt` (the artifacts project stubs a `.css` import) and METADATA.pb files. The web project has
// these through `vite/client`; the node project, which typechecks src/artifacts/ as main imports it, declares them here.
declare module '*.txt?raw' {
  const text: string;
  export default text;
}
declare module '*.pb?raw' {
  const text: string;
  export default text;
}

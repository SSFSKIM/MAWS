// Vite's `?raw` import of a file as text: the HTML export inlines the editor's theme.css, and the import suites read
// their HTML fixtures. The web project has these through `vite/client`; the node project, which typechecks
// src/artifacts/ as main imports it, declares them here (`*.md?raw` is src/artifacts/types/raw.d.ts's).
declare module '*.css?raw' {
  const css: string;
  export default css;
}
declare module '*.html?raw' {
  const html: string;
  export default html;
}

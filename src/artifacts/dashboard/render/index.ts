// The dashboard's renderer (P3-E2 M3): one pure function from a view spec, a snapshot's rows and the page's theme to
// one SVG, read alike by the editor, main's exporters and Node.
export { renderView, renderFailure, captionOf, type Rendered } from './render';
export { themeFrom, THEME_PROPERTIES, FIGURE_WIDTH, type Theme } from './svg';
export { transform, compareCells, instantOf, type ViewColumn, type ViewTable } from './transform';

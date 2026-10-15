// Vite's `import.meta.glob` (defaults.ts, default-assets.ts), for the Node tsconfig, which does not load `vite/client`;
// the type is vite/client's own, so the web tsconfig sees one declaration twice.
interface ImportMeta {
  glob: import('vite').ImportGlobFunction;
}

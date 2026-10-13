// Vite's `?raw` import of a kind's markdown file (guides.ts), for the Node tsconfig, which does not load `vite/client`.
declare module '*.md?raw' {
  const text: string;
  export default text;
}

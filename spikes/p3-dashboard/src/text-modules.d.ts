// The datasets imported as text by e2e/build.mjs's esbuild `text` loader.
declare module '*.csv' {
  const text: string;
  export default text;
}

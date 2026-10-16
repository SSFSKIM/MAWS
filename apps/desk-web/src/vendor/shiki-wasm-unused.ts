// What `shiki/wasm` resolves to in the desk's build (vite.config.ts). The desk highlights code with shiki's JavaScript
// regex engine (MAWS's `code-plugin.ts` passes it to `createHighlighter`), so the Oniguruma WASM engine that shiki's
// full bundle names as its default is never loaded; without this alias its 608 KB inline WASM is built as a chunk anyway.
throw new Error("the desk highlights with shiki's JavaScript engine; the Oniguruma WASM is not bundled");

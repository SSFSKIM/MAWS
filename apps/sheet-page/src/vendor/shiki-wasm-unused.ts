// What `shiki/wasm` resolves to in the page's build (vite.config.ts), as in desk-web's: the sheet's Markdown highlights
// with shiki's JavaScript regex engine, so the Oniguruma WASM that shiki's full bundle names as its default is never
// loaded, and without this alias its inline WASM would be built as a chunk anyway.
throw new Error("the sheet page highlights with shiki's JavaScript engine; the Oniguruma WASM is not bundled");

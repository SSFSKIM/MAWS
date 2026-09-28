import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const alias = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig(({ command }) => {
  // Development CSP nonce: minted once per evaluation of this file and handed to both sides, to the dev server's
  // HTML (Vite stamps it on every script and style tag, including plugin-react's inline fast-refresh preamble) and
  // to main's CSP header. A build defines it as null and stamps nothing, so production carries no nonce at all.
  const devNonce = command === 'serve' ? randomBytes(16).toString('base64') : null;

  return {
    main: {
      resolve: { alias },
      define: { __MAWS_DEV_CSP_NONCE__: JSON.stringify(devNonce) },
    },
    preload: {
      resolve: { alias },
    },
    renderer: {
      resolve: { alias },
      html: devNonce ? { cspNonce: devNonce } : undefined,
      plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
    },
  };
});

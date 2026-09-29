// C8b's live acceptance build (C8b execution document, acceptance item 4): the product build with the renderer's
// development-only surfaces switched on (`import.meta.env.DEV`: `window.__maws_agents` from App.tsx's C8b block, the
// Diagnostics launcher), so Playwright drives the built app and still reads the stores item 4 names. electron-vite forces
// NODE_ENV=production for `build`, so the flag is defined here, over the repository's own config, for this build only:
//   pnpm exec electron-vite build -c e2e/support/dev-surface.vite.config.mjs
// Plain JavaScript on purpose: the e2e typecheck (skipLibCheck off) would otherwise read electron-vite's declarations.
import base from '../../electron.vite.config';

export default (env) => {
  const config = base(env);
  return { ...config, renderer: { ...config.renderer, define: { ...config.renderer?.define, 'import.meta.env.DEV': 'true' } } };
};

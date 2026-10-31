// The render library's e2e seams (P3-L M6b's `__maws_captures`, P3-A M7 fix wave 1's `__maws_exports`), installed under
// MAWS_E2E=1 by whichever root composes the library (P5 O5 M3: main's embedded root and the render host alike), so an
// e2e drives the same code in either process through `electronApp.evaluate`: a capture run directly (no IPC command
// exists for it), the PDF printer alone (its request filter), and a document's viewport render (hostile HTML beside the
// host's own layout reads). Answers the removal.
import type { MawsArtifactCapture } from '@shared/ipc/schema/maws';
import { captureArtifact, type CaptureDeps } from './capture';
import { printHtmlToPdf } from './export';
import { renderDocumentViewport } from './inspection';

interface RenderSeams {
  __maws_captures?: { capture(request: MawsArtifactCapture): ReturnType<typeof captureArtifact> };
  __maws_exports?: { print(html: string): Promise<{ head: string; blocked: string[] }>; inspect(html: string): Promise<string> };
}

export function installRenderSeams({ content, env }: CaptureDeps): () => void {
  if (env.MAWS_E2E !== '1') return () => {};
  const seam = globalThis as RenderSeams;
  seam.__maws_captures = { capture: (request) => captureArtifact(request, { content, env }) };
  seam.__maws_exports = {
    // The real document viewport path, so the e2e can inject hostile HTML and prove CSP beside host layout reads.
    inspect: async (html) => (await renderDocumentViewport(html, { artifactId: 'e2e-inspection', kind: 'document', format: 'png', revision: 0, path: '', width: 640, height: 480 }, new AbortController().signal, env)).toString('base64'),
    print: async (html) => {
      const blocked: string[] = [];
      const pdf = await printHtmlToPdf(html, { signal: new AbortController().signal, blocked: (url) => blocked.push(url) });
      return { head: Buffer.from(pdf.subarray(0, 5)).toString('latin1'), blocked };
    },
  };
  return () => {
    delete seam.__maws_captures;
    delete seam.__maws_exports;
  };
}

// A deck's live embeds for the presenter (P3-C M6; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13 and
// Decision Log 18): `maws-artifact://<deck>/live/embeds/<slide>/<element>.html` answers the x-embed's page from the
// deck's live state (`artifacts.state`, read once per revision), with the embed's own policy in the answer: sandboxed
// with scripts, no network (`EMBED_PAGE_CSP`). A `srcdoc` frame inherits the app's policy, so an embed's scripts run only
// this way. Consulted by the store's scheme handler before its file resolver; any other URL is the store's.
import { readFlat } from '@artifacts/slides/model';
import { EMBED_PAGE_CSP, EMBED_PATH, embedDocument } from '@artifacts/slides/render-rules';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import { hasSlide } from '@artifacts/yjs/slides';
import { parseArtifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';

export { embedUrl } from '@artifacts/slides/render-rules';

export type HostCall = <N extends CommandName>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>>;

/** An answer for a presentation's embed URL, or null for a URL that is not one (the store's file resolver takes it). */
export type EmbedResponder = (request: Request) => Promise<Response | null>;

const notFound = () => new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

export function presentationEmbeds(call: HostCall): EmbedResponder {
  let cached: { artifactId: string; revision: number; doc: Doc } | null = null;
  const deckAt = async (artifactId: string, revision: number): Promise<Doc | null> => {
    if (cached?.artifactId === artifactId && cached.revision === revision) return cached.doc;
    const state = await call('artifacts.state', { artifactId });
    if (!state.ok) return null;
    const doc = newDoc();
    applyV2(doc, state.value.bytes);
    cached?.doc.destroy();
    cached = { artifactId, revision: state.value.revision, doc };
    return doc;
  };
  return async (request) => {
    const target = parseArtifactUrl(request.url);
    const embed = target && target.revision === 'live' ? EMBED_PATH.exec(target.path) : null;
    if (!target || !embed) return null;
    const row = await call('artifacts.get', { artifactId: target.artifactId });
    if (!row.ok || row.value.artifact?.kind !== 'presentation') return null;
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    const doc = await deckAt(target.artifactId, row.value.artifact.revision);
    const [, slideId, elementId] = embed;
    const element = doc && hasSlide(doc, slideId!) ? readFlat(doc, slideId!, false).find((e) => e.id === elementId) : undefined;
    if (!element || element.tag !== 'x-embed') return notFound();
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': EMBED_PAGE_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    return new Response(request.method === 'HEAD' ? null : embedDocument(element.raw ?? ''), { status: 200, headers });
  };
}

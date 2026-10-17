// The design kind's exporters in A's export registry (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5;
// the parent's §1 "Export", XE9 and Decision Log 26; X31's `registerDesignExporters`): `design` × `png` and `pdf`,
// reached by the agent's `artifact_export`, the editor's Export sheet and the library's Export alike.
//
// Each reads the design's state as the export took it (the live revision or a retained version's) through the design
// model, a legacy file state projected on a temporary copy and never migrated, and materializes what it draws at once
// (src/artifacts/design/export.ts): the selection and the limits are decided there before any window opens, a refusal
// raised through A's `CommandFailure` with its `ArtifactRefusal` (`exportTooLarge {board, w, h, maxScale}`, `notFound`,
// `invalid`), which A's runner, the library's route and the tool carry to the caller. Then, as C's presentation export
// does (src/main/presentations/export.ts, reused, not copied): the design system governing it as the engine host names
// it (a version's pin for a version), its tokens in the `document` medium the workbench draws boards in, with the
// design's overrides; the faces and the uploaded assets the selected boards name; C's standalone page with the boards
// at their manifest sizes and the design's screen type defaults (BOARD_CSS); C's capture window and measure.
// - `png`: the board as the window draws it, its frame the capture's box (grown past the window as C grows it for a
//   large element); at a scale its frame is zoomed for the draw, so the picture is drawn at the output's resolution, never
//   enlarged from a smaller one; resized only to the exact output size when the drawn box rounds otherwise.
// - `pdf`: printed by the service's printer on one page per board at the board's (scaled) size, each embed drawn as the
//   picture the window took of it (the printer runs no script).
import { BOARD_CSS } from '@artifacts/design/board-css';
import { designExportOf, planDesignExport, scaledDrawCss, type DesignExportRefusal } from '@artifacts/design/export';
import { withDesignModel } from '@artifacts/design/migrate';
import { designTokenValues } from '@artifacts/design/mirror';
import type { ExportDeck, PageOptions } from '@artifacts/slides/export/standalone';
import { deckAssetRefs, deckFacesCss, deckPage } from '@artifacts/slides/export/standalone';
import { applyV2, newDoc } from '@artifacts/yjs';
import { ipcError } from '@shared/ipc/errors';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import { CommandFailure } from '../ipc/router';
import type { Exporter, ExportContext, ExporterRegistry, ExportRequest } from '../artifacts/export';
import type { SeamEnv } from '../artifacts/policies';
import { deckSystem, measurePass, systemFacesCss, withDeckWindow, type DeckWindow, type PresentationExportDeps } from '../presentations/export';

export interface DesignExportDeps extends PresentationExportDeps {
  /** C's capture window (`withDeckWindow`); a test's stand-in. */
  window?: <T>(env: SeamEnv, signal: AbortSignal, use: (win: DeckWindow) => Promise<T>) => Promise<T>;
}

/** A refusal the caller can act on, through A's command failure (Decision Log 26). */
const refused = (refusal: DesignExportRefusal) => new CommandFailure(ipcError('invalid_input', refusal.message, { reason: refusal.reason, data: refusal.data } satisfies ArtifactRefusal));

const dataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const pngUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
/** The page's own CSS after C's: the design's screen type defaults, then `more` (a scaled draw's). */
const designCss = (more = '') => [BOARD_CSS, more].filter(Boolean).join('\n');

/** The page options every pass of `deck` shares: the system's document-medium tokens, the assets and faces it names. */
async function pageOptions(request: ExportRequest, context: ExportContext, deck: ExportDeck, deps: DesignExportDeps): Promise<Omit<PageOptions, 'mode'>> {
  const system = await deckSystem(request, deps);
  const resolveVar = designTokenValues(system.tokens, deck.overrides);
  const urls = new Map<string, string>();
  for (const ref of deckAssetRefs(deck)) {
    const found = await context.readAsset(ref);
    if (found) urls.set(ref, dataUrl(found.bytes, found.mime));
  }
  const asset = (ref: string) => urls.get(ref) ?? null;
  const facesCss = `${await systemFacesCss(system, deps)}${deckFacesCss(deck, asset)}`;
  return { resolveVar, asset, facesCss, only: deck.slides.map((s) => s.id), extraCss: designCss() };
}

async function run(request: ExportRequest, context: ExportContext, deps: DesignExportDeps): Promise<void> {
  // the state through the design model, read whole before anything is awaited (the temporary copy freed at once)
  const doc = newDoc();
  let source: ReturnType<typeof designExportOf>;
  try {
    applyV2(doc, await context.state());
    source = withDesignModel(doc, (model) => designExportOf(model, context.title));
  } finally {
    doc.destroy();
  }
  const plan = planDesignExport(source, { format: request.format === 'png' ? 'png' : 'pdf', board: request.board, boards: request.boards, scale: request.scale, width: request.width, height: request.height, pageSize: request.pageSize });
  if (!plan.ok) throw refused(plan.refusal);
  const page = await pageOptions(request, context, plan.deck, deps);
  const withWindow = deps.window ?? withDeckWindow;

  if (plan.format === 'png') {
    const { board, scale, width, height } = plan;
    const scaled = designCss(scaledDrawCss([board], scale, false));
    // a whole-pixel board at native size is captured as it is; any other draw is brought to the exact output size
    const exact = scale === 1 && Number.isInteger(board.w) && Number.isInteger(board.h) && width === board.w && height === board.h;
    const bytes = await withWindow(deps.env, context.signal, async (win) => {
      const measured = await measurePass(win, { deck: plan.deck, page });
      await win.load(deckPage(plan.deck, { ...page, extraCss: scaled, mode: 'measure', measured }));
      return win.capture({ slideId: board.id, elementId: null, mode: 'slide', box: { x: 0, y: 0, w: width, h: height } }, exact ? undefined : { width, height });
    });
    await context.writeFile(request.path, bytes);
    return;
  }

  const html = await withWindow(deps.env, context.signal, async (win) => {
    const measured = await measurePass(win, { deck: plan.deck, page });
    // the printer runs no script: each embed is the picture the window takes of it, at the board's native size
    const embeds = measured.slides.flatMap((s) => s.elements.filter((e) => e.tag === 'x-embed').map((e) => ({ slideId: s.id, elementId: e.id, mode: 'tree' as const, box: e.box })));
    const pictures = new Map<string, Map<string, string>>();
    if (embeds.length) {
      await win.load(deckPage(plan.deck, { ...page, mode: 'measure', measured }));
      for (const job of embeds) {
        const slide = pictures.get(job.slideId) ?? new Map<string, string>();
        slide.set(job.elementId, pngUrl(await win.capture(job)));
        pictures.set(job.slideId, slide);
      }
    }
    return deckPage(plan.deck, { ...page, extraCss: designCss(scaledDrawCss(plan.boards, plan.scale, true)), mode: 'print', measured, pictures });
  });
  await context.writeFile(request.path, await context.printToPdf(html));
}

/** Registers the design's PNG and PDF exporters (X31); the answer withdraws them. */
export function registerDesignExporters(registry: Pick<ExporterRegistry, 'register'>, deps: DesignExportDeps): () => void {
  const offs = (['png', 'pdf'] as const).map((format) => {
    const exporter: Exporter = { kind: 'design', format, run: (request, context) => run(request, context, deps) };
    return registry.register(exporter);
  });
  return () => offs.forEach((off) => off());
}

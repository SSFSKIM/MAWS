// P3-E1 M2 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's §1 and Decision Logs 11 and 13):
// the engine host's design module. It registers the `design` kind's adapter with A's document service (its seed, files,
// three-way publish, repair, restore and legacy migration hooks) and its linked-directory mirror writer with L's
// registry, and nothing else: A's tools route a design's create, read and publish through the adapter, A's host
// boundaries run its migration (`ArtifactStore.ensureMigrated`), and the design's thread tools are wrapped in
// `./threads.ts`. Wired by one line after P3-C's in `src/engine-host/index.ts`.
//
// The mirror follows the system governing the design as the deck's does (C's Decision Log 29): the writer's `inputs` are
// the governing ref, that system's revision and the design's asset count, and the module asks L's mirror to refresh every
// design when a design system changes and when the chain's defaults do. The writer resolves tokens in the `document`
// medium the workbench draws boards in. A startup mirror reads a design no actor has opened since E1 without migrating
// it: the writer projects a legacy state on a temporary copy (Decision Log 13 (3)).
// M4: under MAWS_E2E=1 with MAWS_DESIGN_HISTORY named, the e2e seam that writes as an agent's session (./history-seam.ts).
// M6: under MAWS_E2E=1 with MAWS_DESIGN_PERF named, the scale gate's seam (e2e/design-scale.spec.ts): C's deck scale seam
// reused as it is, since its tools are A's generic `artifact_read` and `artifact_publish` run as an agent's session, a
// design's publish going through this kind's adapter, and the host loop sampled around each call.
import { createDesignAdapter } from '@artifacts/design/adapter';
import { designMirrorWriter } from '@artifacts/design/mirror';
import { readSystem } from '@artifacts/design-system/model';
import type { TokenSet } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
import { registerMirrorWriter, type MirrorWriter } from '@artifacts/library/mirror';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Artifact } from '@shared/artifacts/entity';
import type { DesignSystemChain } from '../design-systems/chain';
import type { Documents } from '../documents';
import type { DocumentService } from '../documents/service';
import type { ArtifactStore } from '../documents/store';
import { startPresentationsScaleSeam } from '../presentations/scale-seam';
import { designSeamDir, startDesignSeam } from './history-seam';

export interface Designs {
  close(): void;
}

export interface DesignsDeps {
  documents: Pick<Documents, 'store' | 'service'> | null;
  chain: Pick<DesignSystemChain, 'governing'> | null; // P3-D's default chain; null while the store is unavailable
  /** L's mirror's `refresh`: schedules the designs named, as their own change would. */
  refresh(artifactIds: string[]): void;
  /** M4: the host's environment (the e2e seam opens under MAWS_E2E=1 only); `process.env` by default. */
  env?: Record<string, string | undefined>;
}

export function registerDesigns({ documents, chain, refresh, env = process.env }: DesignsDeps): Designs {
  if (!documents) return { close: () => {} };
  const { store, service } = documents;
  store.registerAdapter(createDesignAdapter());
  const writer: MirrorWriter = Object.assign(
    designMirrorWriter((artifact) => governingTokens(service, chain, artifact)),
    { inputs: (artifact: Artifact) => governingInputs(store, chain, artifact) },
  );
  const unregisterMirror = registerMirrorWriter('design', writer);
  const refreshDesigns = () => {
    const ids = store.list({ kind: 'design' }).map((design) => design.id);
    if (ids.length > 0) refresh(ids);
  };
  const offs = [store.onChange(({ kind }) => kind === 'design_system' && refreshDesigns()), store.onDefaultsChange(refreshDesigns)];
  const seamDir = designSeamDir(env); // M4: an agent's writes, replies and resolutions, for the e2e
  if (seamDir) offs.push(startDesignSeam({ store, service }, seamDir).close);
  const perfDir = designPerfSeamDir(env); // M6: the scale gate's agent session
  if (perfDir) offs.push(startPresentationsScaleSeam(store, perfDir, (line) => console.warn(`[design-scale] ${line}`)).close);
  return {
    close: () => {
      for (const off of offs) off();
      unregisterMirror();
    },
  };
}

/** M6: the scale gate's channel, when the host runs for it (MAWS_E2E=1 and MAWS_DESIGN_PERF naming the directory). */
export const designPerfSeamDir = (env: Record<string, string | undefined>): string | null => (env.MAWS_E2E === '1' && env.MAWS_DESIGN_PERF ? env.MAWS_DESIGN_PERF : null);

const governingRef = (chain: DesignsDeps['chain'], artifact: Artifact) => chain?.governing({ designSystemId: artifact.designSystemId, spaceId: artifact.spaceId }) ?? { builtin: 'maws' as const };

/** The design mirror's inputs: the governing system and its revision (the floor's has none), and its asset count. */
function governingInputs(store: ArtifactStore, chain: DesignsDeps['chain'], artifact: Artifact): string {
  const ref = governingRef(chain, artifact);
  const governing = 'builtin' in ref ? `builtin:${ref.builtin}` : `${ref.id}@${store.revision(ref.id)}`;
  const assets = store.listAssets(artifact.id).length;
  return assets > 0 ? `${governing} assets:${assets}` : governing;
}

/** The tokens of the system governing a design, live: its own, its Space's, the owner's, the house system, else the floor. */
function governingTokens(service: DocumentService, chain: DesignsDeps['chain'], artifact: Artifact): TokenSet | null {
  const ref = governingRef(chain, artifact);
  if ('builtin' in ref) return builtinView().tokens;
  const loaded = service.loaded(ref.id);
  if (loaded) return readSystem(loaded).tokens;
  const doc = newDoc();
  try {
    applyV2(doc, service.readState(ref.id).state);
    return readSystem(doc).tokens;
  } finally {
    doc.destroy();
  }
}

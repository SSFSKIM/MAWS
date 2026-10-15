// The engine host's presentation module (P3-C M3; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D7): registers
// the `presentation` kind's adapter with A's document service (its first content, its files, its three-way publish, its
// repair and restore hooks) and its linked-directory mirror writer with L's registry, and nothing else: A's tools route a
// deck's create, read and publish through the adapter. The writer resolves the deck's tokens in the system governing it,
// read through P3-D's chain synchronously over the store's committed state. Wired by one line beside P3-A's, P3-L's and
// P3-D's in `src/engine-host/index.ts`.
//
// The mirror's freshness (Decision Log 29; the P3 spec's Decision Log 69): the writer declares its `inputs`, the
// governing ref and that system's revision, so L's mirror rewrites a deck whose system changed with no write to the deck;
// the module asks the mirror to refresh every deck when a design system changes and when the chain's defaults do
// (`artifacts.setDefaults`), the `inputs` compare deciding which decks are rewritten (no inverse of the chain kept).
import { readSystem } from '@artifacts/design-system/model';
import type { TokenSet } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
import { registerMirrorWriter, type MirrorWriter } from '@artifacts/library/mirror';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { presentationMirrorWriter } from '@artifacts/slides/mirror';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Artifact } from '@shared/artifacts/entity';
import type { DesignSystemChain } from '../design-systems/chain';
import type { Documents } from '../documents';
import type { DocumentService } from '../documents/service';
import type { ArtifactStore } from '../documents/store';

export interface Presentations {
  close(): void;
}

export interface PresentationsDeps {
  documents: Pick<Documents, 'store' | 'service'> | null;
  chain: Pick<DesignSystemChain, 'governing'> | null; // P3-D's default chain; null while the store is unavailable
  /** L's mirror's `refresh` (Decision Log 29): schedules the decks named, as their own change would. */
  refresh(artifactIds: string[]): void;
}

export function registerPresentations({ documents, chain, refresh }: PresentationsDeps): Presentations {
  if (!documents) return { close: () => {} };
  const { store, service } = documents;
  store.registerAdapter(createPresentationAdapter());
  const writer: MirrorWriter = Object.assign(
    presentationMirrorWriter((artifact) => governingTokens(service, chain, artifact)),
    { inputs: (artifact: Artifact) => governingInputs(store, chain, artifact) },
  );
  const unregisterMirror = registerMirrorWriter('presentation', writer);
  const refreshDecks = () => {
    const decks = store.list({ kind: 'presentation' }).map((deck) => deck.id);
    if (decks.length > 0) refresh(decks);
  };
  const offs = [store.onChange(({ kind }) => kind === 'design_system' && refreshDecks()), store.onDefaultsChange(refreshDecks)];
  return {
    close: () => {
      for (const off of offs) off();
      unregisterMirror();
    },
  };
}

const governingRef = (chain: PresentationsDeps['chain'], artifact: Artifact) => chain?.governing({ designSystemId: artifact.designSystemId, spaceId: artifact.spaceId }) ?? { builtin: 'maws' as const };

/** The deck mirror's inputs: the system governing it and that system's revision (the floor's has none). */
function governingInputs(store: ArtifactStore, chain: PresentationsDeps['chain'], artifact: Artifact): string {
  const ref = governingRef(chain, artifact);
  return 'builtin' in ref ? `builtin:${ref.builtin}` : `${ref.id}@${store.revision(ref.id)}`;
}

/** The tokens of the system governing a deck, live: its own, its Space's, the owner's, the house system, else the floor. */
function governingTokens(service: DocumentService, chain: PresentationsDeps['chain'], artifact: Artifact): TokenSet | null {
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

// The engine host's presentation module (P3-C M3; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D7): registers
// the `presentation` kind's adapter with A's document service (its first content, its files, its three-way publish, its
// repair and restore hooks) and its linked-directory mirror writer with L's registry, and nothing else: A's tools route a
// deck's create, read and publish through the adapter. The writer resolves the deck's tokens in the system governing it,
// read through P3-D's chain synchronously over the store's committed state. Wired by one line beside P3-A's, P3-L's and
// P3-D's in `src/engine-host/index.ts`.
import { readSystem } from '@artifacts/design-system/model';
import type { TokenSet } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
import { registerMirrorWriter } from '@artifacts/library/mirror';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { presentationMirrorWriter } from '@artifacts/slides/mirror';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Artifact } from '@shared/artifacts/entity';
import type { DesignSystemChain } from '../design-systems/chain';
import type { Documents } from '../documents';
import type { DocumentService } from '../documents/service';

export interface Presentations {
  close(): void;
}

export interface PresentationsDeps {
  documents: Pick<Documents, 'store' | 'service'> | null;
  chain: Pick<DesignSystemChain, 'governing'> | null; // P3-D's default chain; null while the store is unavailable
}

export function registerPresentations({ documents, chain }: PresentationsDeps): Presentations {
  if (!documents) return { close: () => {} };
  documents.store.registerAdapter(createPresentationAdapter());
  const unregisterMirror = registerMirrorWriter('presentation', presentationMirrorWriter((artifact) => governingTokens(documents.service, chain, artifact)));
  return { close: unregisterMirror };
}

/** The tokens of the system governing a deck, live: its own, its Space's, the owner's, the house system, else the floor. */
function governingTokens(service: DocumentService, chain: PresentationsDeps['chain'], artifact: Artifact): TokenSet | null {
  const ref = chain?.governing({ designSystemId: artifact.designSystemId, spaceId: artifact.spaceId }) ?? { builtin: 'maws' as const };
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

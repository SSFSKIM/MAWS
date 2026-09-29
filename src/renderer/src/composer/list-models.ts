// The one way C7 reads a session's models (`session.listModels`, a control request to the engine, so only when a
// reader is enabled: a chip or the mode menu that shows them opened, never per mount). Every answer is remembered per
// session in the composer store, so the model chip can name the model from the first read on, whichever reader made
// it and however many mounts later.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useCommand } from '../ipc/query';
import { rememberListedModels, type ListedModel } from '../stores/composer';

export function useListModels(appSessionId: AppSessionId, enabled: boolean): readonly ListedModel[] | null {
  const read = useCommand('session.listModels', { appSessionId }, { enabled, staleTime: 60_000 });
  const models = read.data?.models ?? null;
  useEffect(() => {
    if (models) rememberListedModels(appSessionId, models);
  }, [appSessionId, models]);
  return models;
}

// Red first: the names exist, their bodies are built next.
import type { SchemeResponder } from '../../services/artifacts/scheme/artifact-handler';
import type { FrameToken, FrameTokens } from './tokens';

export function fileFrameResponder(_tokens: Pick<FrameTokens, 'get'>, _failed: (token: FrameToken) => void, _entered?: (request: Request) => void): SchemeResponder {
  return async () => {
    throw new Error('not built');
  };
}

// UX wave U1c (l4-approvals-12; the U1c document, Interfaces §E): "Approve and retry" supplied to the transcript through
// its actions, as the composer's edit actions are, so the transcript's view imports no app store for it and a mount that
// omits it (the desk's web app, the harness) draws none.
import { createElement } from 'react';
import { registerTranscriptActions } from '../transcript';
import { ApproveAndRetry } from './ApproveAndRetry';

export function registerBlockedCalls(): () => void {
  return registerTranscriptActions({ renderBlockedCall: (props) => createElement(ApproveAndRetry, props) });
}

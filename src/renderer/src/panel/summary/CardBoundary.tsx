// One card's throw while drawing stays in its card: uncaught, it unmounts the whole window (seen 2026-11-23: a session
// with no folder threw in Environment and the app went blank). The card says so in one muted line and logs the error;
// the column is keyed by session, so another session's cards draw afresh.
import { Component, type ReactNode } from 'react';
import { SUMMARY_COPY } from '../copy';

export class CardBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error(`[summary] the ${this.props.name} card failed to draw`, error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="status" data-testid="card-failed" className="m-0 px-2 py-1 text-ui-sm text-fg-muted">
        {SUMMARY_COPY.cardFailed(this.props.name)}
      </p>
    );
  }
}

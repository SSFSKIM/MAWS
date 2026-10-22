import { Component, type ReactNode } from 'react';

/** A failed recovery must leave a way back, not a blank home-screen app. */
export class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-ui text-fg">
        <p className="m-0 text-center">The desk could not load. Check your connection, then reload to try again.</p>
        <button type="button" className="rounded-sm border border-border-strong px-3 py-2 hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent" onClick={() => location.reload()}>Reload the desk</button>
      </div>
    );
  }
}

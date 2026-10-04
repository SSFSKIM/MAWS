// A mod's drawing may fail downstream of validation. Keep the failure local, restore native content,
// and retry only for a new answer. One warning per mounted site avoids flooding on repeated bad redraws.
import { Component, type ReactNode } from 'react';
import type { SiteAnswer } from './registry';

interface Props {
  answer: SiteAnswer | null;
  name: string;
  fallback?: ReactNode;
  onError?: (answer: SiteAnswer | null) => void;
  children: ReactNode;
}
export class SurfaceBoundary extends Component<Props, { answer: SiteAnswer | null; failed: boolean }> {
  state = { answer: this.props.answer, failed: false };
  private reported = false;
  static getDerivedStateFromProps(props: Props, state: { answer: SiteAnswer | null }) {
    return props.answer === state.answer ? null : { answer: props.answer, failed: false };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    if (!this.reported) {
      this.reported = true;
      console.warn(`[engine-surface] ${this.props.name}: drawing failed; showing native content`, error);
    }
    this.props.onError?.(this.props.answer);
  }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children; }
}

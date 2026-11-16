import { Component, type ReactNode } from 'react';
import { ErrorState } from '@/components/page/states';

/**
 * A page that throws while rendering, or whose code could not be loaded, shows a message with a
 * reload instead of blanking the whole app. `resetKey` (the route) clears it when Ben goes elsewhere.
 */
export class PageErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    console.error('page failed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-3xl px-4 pt-8 lg:px-8">
        <ErrorState message="This page could not be shown. Reloading loads the latest version of Kevin." onRetry={() => window.location.reload()} />
      </div>
    );
  }
}

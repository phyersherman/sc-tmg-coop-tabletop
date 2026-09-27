import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <section className="panel accent">
          <h3>Something went wrong</h3>
          <p className="mono small">{this.state.error.message}</p>
          <p className="small muted">Your game is still saved. Try Undo from the game screen, or reload the page.</p>
          <button className="btn" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>Try again</button>
        </section>
      );
    }
    return this.props.children;
  }
}

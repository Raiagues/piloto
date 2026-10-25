import { Component } from 'react';
import type { ReactNode } from 'react';

/** A stale or unavailable route chunk must offer recovery instead of a blank screen. */
export class PageBoundary extends Component<{ children: ReactNode; route: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidUpdate(previous: Readonly<{ children: ReactNode; route: string }>) {
    if (this.state.failed && previous.route !== this.props.route) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const pt = document.documentElement.lang !== 'en';
    return <section className="auth-status-screen" role="alert">
      <h1>{pt ? 'Não foi possível abrir esta tela.' : 'This page could not be opened.'}</h1>
      <button type="button" onClick={() => window.location.reload()}>{pt ? 'Recarregar' : 'Reload'}</button>
      <a href="#/">{pt ? 'Voltar ao início' : 'Back home'}</a>
    </section>;
  }
}

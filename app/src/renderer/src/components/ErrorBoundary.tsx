import { Component, type ReactNode } from 'react'

/** Keeps one broken page or dialog from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty">
        <h3>Something broke here.</h3>
        <p className="mono muted">{this.state.error.message}</p>
        <div className="actions center">
          <button
            className="btn"
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset?.()
            }}
          >
            Back to the library
          </button>
        </div>
      </div>
    )
  }
}
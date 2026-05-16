import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 flex flex-col items-center justify-center h-screen font-sans text-text-primary">
          <h2 className="mb-2">Something went wrong</h2>
          <p className="text-text-secondary mb-4">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 rounded-[6px] border border-border bg-bg-secondary cursor-pointer text-sm"
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

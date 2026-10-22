import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorScreen } from './ErrorScreen'

/** The root of the window: a render that throws shows what happened and a reload button, instead of
 *  React unmounting the whole tree and leaving an empty window. Sits inside I18nProvider so the text
 *  is translated. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render error', error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.error ? <ErrorScreen error={this.state.error} /> : this.props.children
  }
}

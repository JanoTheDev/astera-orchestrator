import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { CrashOffer } from '../../../core/crash/report'
import { ErrorScreen } from './ErrorScreen'
import { CrashReportPrompt, reportRendererError } from './CrashReportPrompt'

type State = { error: Error | null; offer: CrashOffer | null; reporting: boolean }

/** The root of the window: a render that throws shows what happened and a reload button, instead of
 *  React unmounting the whole tree and leaving an empty window. Sits inside I18nProvider so the text
 *  is translated. T27: the error is written as a crash report, and ErrorScreen's Report opens the prompt for it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, offer: null, reporting: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, offer: null, reporting: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render error', error, info.componentStack)
    void reportRendererError('render', error).then((offer) => this.setState({ offer }))
  }

  render(): ReactNode {
    const { error, offer, reporting } = this.state
    if (!error) return this.props.children
    return (
      <>
        <ErrorScreen error={error} onReport={offer ? () => this.setState({ reporting: true }) : undefined} />
        {reporting && offer && <CrashReportPrompt offer={offer} onClose={() => this.setState({ reporting: false })} />}
      </>
    )
  }
}

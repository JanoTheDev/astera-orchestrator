import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../i18n/I18nProvider'

function RenderError({ error }: { error: Error }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div role="alert" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <strong>{t('app.renderError')}</strong>
      <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.7, margin: 0 }}>{error.message}</pre>
      <button type="button" onClick={() => window.location.reload()}>
        {t('app.renderErrorReload')}
      </button>
    </div>
  )
}

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
    return this.state.error ? <RenderError error={this.state.error} /> : this.props.children
  }
}

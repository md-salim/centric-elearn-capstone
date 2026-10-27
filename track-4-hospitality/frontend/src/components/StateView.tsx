import type { ReactNode } from 'react'
import type { AsyncState } from '../hooks/useAsync'

interface Props<T> {
  state: AsyncState<T>
  isEmpty: (data: T) => boolean
  emptyText: string
  onRetry?: () => void
  children: (data: T) => ReactNode
}

export default function StateView<T>({ state, isEmpty, emptyText, onRetry, children }: Props<T>) {
  if (state.loading) return <p className="state">Loading...</p>
  if (state.error) return (
    <div className="state error">
      <p>Something went wrong: {state.error}</p>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  )
  if (!state.data || isEmpty(state.data)) return <p className="state">{emptyText}</p>
  return <>{children(state.data)}</>
}

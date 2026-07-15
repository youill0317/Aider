import { SelectEmbedding } from '../../database/schema'
import DotLoader from '../common/DotLoader'

export type QueryProgressState =
  | {
      type: 'reading-mentionables'
    }
  | {
      type: 'indexing'
      indexProgress: IndexProgress
    }
  | {
      type: 'querying'
    }
  | {
      type: 'querying-done'
      queryResult: (Omit<SelectEmbedding, 'embedding'> & {
        similarity: number
      })[]
    }
  | {
      type: 'idle'
    }

export type IndexProgress = {
  completedChunks: number
  totalChunks: number
  totalFiles: number
  waitingForRateLimit?: boolean
}

export default function QueryProgress({
  state,
}: {
  state: QueryProgressState
}) {
  switch (state.type) {
    case 'idle':
      return null
    case 'reading-mentionables':
      return (
        <div className="smtcmp-query-progress" role="status" aria-live="polite">
          <p>
            Reading mentioned files
            <DotLoader />
          </p>
        </div>
      )
    case 'indexing':
      return (
        <div className="smtcmp-query-progress" role="status" aria-live="polite">
          <p>
            {`Indexing ${state.indexProgress.totalFiles} ${
              state.indexProgress.totalFiles === 1 ? 'file' : 'files'
            }`}
            <DotLoader />
          </p>
          <p className="smtcmp-query-progress-detail">{`${state.indexProgress.completedChunks}/${state.indexProgress.totalChunks} chunks indexed`}</p>
          {state.indexProgress.waitingForRateLimit && (
            <p className="smtcmp-query-progress-detail">
              Waiting for rate limit to reset...
            </p>
          )}
        </div>
      )
    case 'querying':
      return (
        <div className="smtcmp-query-progress" role="status" aria-live="polite">
          <p>
            Querying the vault
            <DotLoader />
          </p>
        </div>
      )
    case 'querying-done':
      return (
        <div className="smtcmp-query-progress" role="status" aria-live="polite">
          <p>
            Reading related files
            <DotLoader />
          </p>
        </div>
      )
  }
}

import { ChevronDown, ChevronRight } from 'lucide-react'
import path from 'path-browserify'
import { useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { SelectEmbedding } from '../../database/schema'
import { getVectorLineRange } from '../../database/vector-metadata'
import { openMarkdownFile } from '../../utils/obsidian'

function SimiliartySearchItem({
  chunk,
}: {
  chunk: Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  }
}) {
  const app = useApp()
  const lineRange = getVectorLineRange(chunk.metadata)

  const handleClick = () => {
    openMarkdownFile(app, chunk.path, lineRange?.startLine)
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="smtcmp-similarity-search-item"
      aria-label={`Open ${path.basename(chunk.path)}${
        lineRange ? ` at line ${lineRange.startLine}` : ''
      }`}
    >
      <div className="smtcmp-similarity-search-item__similarity">
        {chunk.similarity.toFixed(3)}
      </div>
      <div className="smtcmp-similarity-search-item__path">
        {path.basename(chunk.path)}
      </div>
      <div className="smtcmp-similarity-search-item__line-numbers">
        {lineRange
          ? `${lineRange.startLine} - ${lineRange.endLine}`
          : 'File only'}
      </div>
    </button>
  )
}

export default function SimilaritySearchResults({
  similaritySearchResults,
}: {
  similaritySearchResults: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="smtcmp-similarity-search-results">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen)
        }}
        className="smtcmp-similarity-search-results__trigger"
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <div>Show Referenced Documents ({similaritySearchResults.length})</div>
      </button>
      {isOpen && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {similaritySearchResults.map((chunk) => (
            <SimiliartySearchItem key={chunk.id} chunk={chunk} />
          ))}
        </div>
      )}
    </div>
  )
}

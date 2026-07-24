import { ChevronDown, ChevronUp } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'

import DotLoader from '../common/DotLoader'

import { UntrustedMarkdown } from './UntrustedMarkdown'

const AssistantMessageReasoning = memo(function AssistantMessageReasoning({
  reasoning,
  isStreaming = false,
}: {
  reasoning: string
  isStreaming?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showLoader, setShowLoader] = useState(false)
  const previousReasoning = useRef(reasoning)
  const hasUserInteracted = useRef(false)

  useEffect(() => {
    const previous = previousReasoning.current
    previousReasoning.current = reasoning
    if (previous !== reasoning && previous !== '') {
      setShowLoader(true)
      if (!hasUserInteracted.current) {
        setIsExpanded(true)
      }
      const timer = setTimeout(() => {
        setShowLoader(false)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [reasoning])

  const handleToggle = () => {
    hasUserInteracted.current = true
    setIsExpanded(!isExpanded)
  }

  return (
    <div className="smtcmp-assistant-message-metadata">
      <button
        type="button"
        className="smtcmp-assistant-message-metadata-toggle"
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        <span>Reasoning {showLoader && <DotLoader />}</span>
        {isExpanded ? (
          <ChevronUp className="smtcmp-assistant-message-metadata-toggle-icon" />
        ) : (
          <ChevronDown className="smtcmp-assistant-message-metadata-toggle-icon" />
        )}
      </button>
      {isExpanded && (
        <div className="smtcmp-assistant-message-metadata-content">
          {isStreaming ? (
            <pre className="smtcmp-streaming-response">{reasoning}</pre>
          ) : (
            <UntrustedMarkdown content={reasoning} scale="xs" />
          )}
        </div>
      )}
    </div>
  )
})

export default AssistantMessageReasoning

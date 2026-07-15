import { CheckIcon, ChevronDown, ChevronUp, X } from 'lucide-react'
import { Notice } from 'obsidian'
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { ApplyViewState } from '../../ApplyView'
import { useApp } from '../../contexts/app-context'
import { DiffBlock, createDiffBlocks } from '../../utils/chat/diff'

import { applyFileChangeIfCurrent } from './apply-file-change'

export default function ApplyViewRoot({
  state,
  close,
}: {
  state: ApplyViewState
  close: () => void
}) {
  const [currentDiffIndex, setCurrentDiffIndex] = useState(0)
  const diffBlockRefs = useRef<(HTMLDivElement | null)[]>([])
  const scrollerRef = useRef<HTMLDivElement>(null)

  const app = useApp()

  const [diff, setDiff] = useState<DiffBlock[]>(() =>
    createDiffBlocks(state.originalContent, state.newContent),
  )
  const modifiedBlockIndices = useMemo(
    () =>
      diff.reduce<number[]>((acc, block, index) => {
        if (block.type !== 'unchanged') {
          acc.push(index)
        }
        return acc
      }, []),
    [diff],
  )

  const scrollToDiffBlock = useCallback(
    (index: number) => {
      if (index >= 0 && index < modifiedBlockIndices.length) {
        const element = diffBlockRefs.current[modifiedBlockIndices[index]]
        if (element) {
          element.scrollIntoView({ block: 'start' })
          setCurrentDiffIndex(index)
        }
      }
    },
    [modifiedBlockIndices],
  )

  const handlePrevDiff = useCallback(() => {
    scrollToDiffBlock(currentDiffIndex - 1)
  }, [currentDiffIndex, scrollToDiffBlock])

  const handleNextDiff = useCallback(() => {
    scrollToDiffBlock(currentDiffIndex + 1)
  }, [currentDiffIndex, scrollToDiffBlock])

  const handleAccept = async () => {
    const newContent = diff
      .map((diffBlock) => {
        if (diffBlock.type === 'modified') {
          return diffBlock.modifiedValue
        } else {
          return diffBlock.value
        }
      })
      .join('\n')
    const applied = await applyFileChangeIfCurrent(
      app.vault,
      state.file,
      state.originalContent,
      newContent,
    )
    if (!applied) {
      new Notice(
        'The note changed during review. Generate the suggestion again to avoid overwriting newer edits.',
      )
      return
    }
    close()
  }

  const handleReject = async () => {
    close()
  }

  const acceptCurrentBlock = (index: number) => {
    setDiff((prevDiff) => {
      const currentPart = prevDiff[index]

      if (currentPart.type === 'unchanged') {
        // Should not happen
        return prevDiff
      }

      if (!currentPart.originalValue) {
        return [...prevDiff.slice(0, index), ...prevDiff.slice(index + 1)]
      }

      const newPart: DiffBlock =
        currentPart.type === 'modified'
          ? {
              type: 'unchanged',
              value: currentPart.originalValue,
            }
          : currentPart

      return [
        ...prevDiff.slice(0, index),
        newPart,
        ...prevDiff.slice(index + 1),
      ]
    })
  }

  const acceptIncomingBlock = (index: number) => {
    setDiff((prevDiff) => {
      const currentPart = prevDiff[index]

      if (currentPart.type === 'unchanged') {
        // Should not happen
        return prevDiff
      }

      if (!currentPart.modifiedValue) {
        return [...prevDiff.slice(0, index), ...prevDiff.slice(index + 1)]
      }

      const newPart: DiffBlock =
        currentPart.type === 'modified'
          ? {
              type: 'unchanged',
              value: currentPart.modifiedValue,
            }
          : currentPart

      return [
        ...prevDiff.slice(0, index),
        newPart,
        ...prevDiff.slice(index + 1),
      ]
    })
  }

  const acceptBothBlocks = (index: number) => {
    setDiff((prevDiff) => {
      const currentPart = prevDiff[index]

      if (currentPart.type === 'unchanged') {
        // Should not happen
        return prevDiff
      }

      const newPart: DiffBlock = {
        type: 'unchanged',
        value: [currentPart.originalValue, currentPart.modifiedValue]
          .filter(Boolean)
          .join('\n'),
      }

      return [
        ...prevDiff.slice(0, index),
        newPart,
        ...prevDiff.slice(index + 1),
      ]
    })
  }

  const updateCurrentDiffFromScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const scrollerRect = scroller.getBoundingClientRect()
    const scrollerTop = scrollerRect.top
    let closestIndex = -1
    let closestDistance = Number.POSITIVE_INFINITY

    for (let i = 0; i < modifiedBlockIndices.length; i++) {
      const element = diffBlockRefs.current[modifiedBlockIndices[i]]
      if (!element) continue

      const rect = element.getBoundingClientRect()
      const distance = Math.abs(rect.top - scrollerTop)
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = i
      }
    }

    if (closestIndex >= 0) setCurrentDiffIndex(closestIndex)
  }, [modifiedBlockIndices])

  useEffect(() => {
    setCurrentDiffIndex((index) =>
      Math.min(index, Math.max(modifiedBlockIndices.length - 1, 0)),
    )
  }, [modifiedBlockIndices.length])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const handleScroll = () => {
      updateCurrentDiffFromScroll()
    }

    scroller.addEventListener('scroll', handleScroll)
    return () => scroller.removeEventListener('scroll', handleScroll)
  }, [updateCurrentDiffFromScroll])

  useEffect(() => {
    if (modifiedBlockIndices.length > 0) {
      scrollToDiffBlock(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div id="smtcmp-apply-view">
      <div className="view-header">
        <div className="view-header-title-container mod-at-start">
          <div className="view-header-title" role="heading" aria-level={1}>
            Review changes
          </div>
          <div
            className="view-actions"
            role="group"
            aria-label="Review actions"
          >
            <div
              className="smtcmp-diff-navigation"
              role="group"
              aria-label="Change navigation"
            >
              <button
                type="button"
                className="clickable-icon"
                onClick={handlePrevDiff}
                disabled={currentDiffIndex <= 0}
                aria-label="Previous change"
              >
                <ChevronUp size={14} />
              </button>
              <span aria-live="polite" aria-atomic="true">
                {modifiedBlockIndices.length > 0
                  ? `${currentDiffIndex + 1} of ${modifiedBlockIndices.length}`
                  : '0 of 0'}
              </span>
              <button
                type="button"
                className="clickable-icon"
                onClick={handleNextDiff}
                disabled={currentDiffIndex >= modifiedBlockIndices.length - 1}
                aria-label="Next change"
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              type="button"
              className="clickable-icon view-action"
              aria-label="Apply changes"
              onClick={handleAccept}
            >
              <CheckIcon size={14} />
              Apply changes
            </button>
            <button
              type="button"
              className="clickable-icon view-action"
              aria-label="Cancel review"
              onClick={handleReject}
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div className="view-content">
        <div className="markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-readable-line-width is-live-preview is-folding show-properties">
          <div className="cm-editor">
            <div className="cm-scroller" ref={scrollerRef}>
              <div className="cm-sizer">
                <div className="smtcmp-inline-title">{state.file.basename}</div>

                {diff.map((block, index) => (
                  <DiffBlockView
                    key={index}
                    block={block}
                    onAcceptIncoming={() => acceptIncomingBlock(index)}
                    onAcceptCurrent={() => acceptCurrentBlock(index)}
                    onAcceptBoth={() => acceptBothBlocks(index)}
                    ref={(el) => {
                      diffBlockRefs.current[index] = el
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const DiffBlockView = forwardRef<
  HTMLDivElement,
  {
    block: DiffBlock
    onAcceptIncoming: () => void
    onAcceptCurrent: () => void
    onAcceptBoth: () => void
  }
>(({ block: part, onAcceptIncoming, onAcceptCurrent, onAcceptBoth }, ref) => {
  if (part.type === 'unchanged') {
    return (
      <div className="smtcmp-diff-block">
        <div style={{ width: '100%' }}>{part.value}</div>
      </div>
    )
  } else if (part.type === 'modified') {
    return (
      <div className="smtcmp-diff-block-container" ref={ref}>
        {part.originalValue && part.originalValue.length > 0 && (
          <div className="smtcmp-diff-block removed">
            <div style={{ width: '100%' }}>{part.originalValue}</div>
          </div>
        )}
        {part.modifiedValue && part.modifiedValue.length > 0 && (
          <div className="smtcmp-diff-block added">
            <div style={{ width: '100%' }}>{part.modifiedValue}</div>
          </div>
        )}
        <div
          className="smtcmp-diff-block-actions"
          role="group"
          aria-label="Choose this change"
        >
          <button
            type="button"
            onClick={onAcceptIncoming}
            className="smtcmp-accept"
          >
            Use suggestion
          </button>
          <button
            type="button"
            onClick={onAcceptCurrent}
            className="smtcmp-exclude"
          >
            Keep original
          </button>
          <button type="button" onClick={onAcceptBoth}>
            Keep both
          </button>
        </div>
      </div>
    )
  }
})

DiffBlockView.displayName = 'DiffBlockView'

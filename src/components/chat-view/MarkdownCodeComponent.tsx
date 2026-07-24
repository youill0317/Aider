import { Check, CopyIcon, Eye, Loader2, Play } from 'lucide-react'
import { Notice } from 'obsidian'
import { PropsWithChildren, useMemo, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useDarkModeContext } from '../../contexts/dark-mode-context'
import { openMarkdownFile } from '../../utils/obsidian'

import { MemoizedSyntaxHighlighterWrapper } from './SyntaxHighlighterWrapper'
import { UntrustedMarkdown } from './UntrustedMarkdown'

const MAX_HIGHLIGHTED_CODE_CHARS = 128 * 1024

export default function MarkdownCodeComponent({
  applyId,
  onApply,
  applyingBlockId,
  language,
  filename,
  children,
}: PropsWithChildren<{
  applyId: string
  onApply: (blockToApply: string, applyId: string) => void
  applyingBlockId: string | null
  language?: string
  filename?: string
}>) {
  const app = useApp()
  const { isDarkMode } = useDarkModeContext()

  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [copied, setCopied] = useState(false)
  const isAnyBlockApplying = applyingBlockId !== null
  const isThisBlockApplying = applyingBlockId === applyId
  const code = String(children)
  const shouldHighlight = code.length <= MAX_HIGHLIGHTED_CODE_CHARS

  const wrapLines = useMemo(() => {
    return !language || ['markdown'].includes(language)
  }, [language])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      new Notice('Failed to copy the code block to the clipboard')
      console.error('Failed to copy text: ', err)
    }
  }

  const handleOpenFile = () => {
    if (filename) {
      openMarkdownFile(app, filename)
    }
  }

  return (
    <div className="smtcmp-code-block">
      <div className="smtcmp-code-block-header">
        {filename && (
          <button
            type="button"
            className="smtcmp-code-block-header-filename"
            onClick={handleOpenFile}
          >
            {filename}
          </button>
        )}
        <div className="smtcmp-code-block-header-button-container">
          <button
            type="button"
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={() => {
              setIsPreviewMode(!isPreviewMode)
            }}
          >
            <Eye size={12} />
            {isPreviewMode ? 'View Raw Text' : 'View Formatted'}
          </button>
          <button
            type="button"
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={() => {
              handleCopy()
            }}
          >
            {copied ? (
              <>
                <Check size={10} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <CopyIcon size={10} />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={() => onApply(code, applyId)}
            disabled={isAnyBlockApplying}
          >
            {isThisBlockApplying ? (
              <>
                <Loader2 className="spinner" size={14} />
                <span>Applying...</span>
              </>
            ) : (
              <>
                <Play size={10} />
                <span>Apply</span>
              </>
            )}
          </button>
        </div>
      </div>
      {isPreviewMode ? (
        <div className="smtcmp-code-block-obsidian-markdown">
          <UntrustedMarkdown content={code} scale="sm" />
        </div>
      ) : !shouldHighlight ? (
        <pre className="smtcmp-code-block-plain">
          <code>{code}</code>
        </pre>
      ) : (
        <MemoizedSyntaxHighlighterWrapper
          isDarkMode={isDarkMode}
          language={language}
          hasFilename={!!filename}
          wrapLines={wrapLines}
        >
          {code}
        </MemoizedSyntaxHighlighterWrapper>
      )}
    </div>
  )
}

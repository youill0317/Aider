import { memo } from 'react'
import ReactMarkdown from 'react-markdown'

type UntrustedMarkdownProps = {
  content: string
  scale?: 'xs' | 'sm' | 'base'
}

const UntrustedMarkdown = memo(function UntrustedMarkdown({
  content,
  scale = 'base',
}: UntrustedMarkdownProps) {
  return (
    <ReactMarkdown
      className={`markdown-rendered smtcmp-markdown-rendered smtcmp-scale-${scale}`}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  )
})

export { UntrustedMarkdown }

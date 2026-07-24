import { ComponentPropsWithoutRef, memo } from 'react'
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
      components={{ img: BlockedImage }}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  )
})

function BlockedImage({
  alt,
  src,
}: Pick<ComponentPropsWithoutRef<'img'>, 'alt' | 'src'>) {
  const trimmedAlt = alt?.trim()
  const label = trimmedAlt ? trimmedAlt : 'image'
  if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        Remote image blocked: {label}
      </a>
    )
  }
  return <span>Image blocked: {label}</span>
}

export { UntrustedMarkdown }

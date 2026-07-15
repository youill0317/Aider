import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { DRAG_DROP_PASTE } from '@lexical/rich-text'
import { COMMAND_PRIORITY_LOW } from 'lexical'
import { useEffect } from 'react'

import {
  MAX_MENTIONABLE_IMAGES,
  MentionableImage,
} from '../../../../../types/mentionable'
import { filesToMentionableImages } from '../../../../../utils/llm/image'

export default function DragDropPaste({
  onCreateImageMentionables,
}: {
  onCreateImageMentionables?: (mentionables: MentionableImage[]) => void
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      DRAG_DROP_PASTE, // dispatched in RichTextPlugin
      (files) => {
        ;(async () => {
          const images = files
            .filter((file) => file.type.startsWith('image/'))
            .slice(0, MAX_MENTIONABLE_IMAGES)
          const mentionableImages = await filesToMentionableImages(images)
          onCreateImageMentionables?.(mentionableImages)
        })().catch(() => {
          console.warn('Unable to attach one or more images')
        })
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, onCreateImageMentionables])

  return null
}

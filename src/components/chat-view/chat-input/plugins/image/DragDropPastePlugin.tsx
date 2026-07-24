import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { DRAG_DROP_PASTE } from '@lexical/rich-text'
import { COMMAND_PRIORITY_LOW } from 'lexical'
import { Notice } from 'obsidian'
import { useEffect, useRef } from 'react'

import {
  MAX_MENTIONABLE_IMAGES,
  MentionableImage,
} from '../../../../../types/mentionable'
import { convertFilesToMentionableImages } from '../../../../../utils/llm/image'

export default function DragDropPaste({
  onCreateImageMentionables,
}: {
  onCreateImageMentionables?: (mentionables: MentionableImage[]) => void
}): null {
  const [editor] = useLexicalComposerContext()
  const onCreateRef = useRef(onCreateImageMentionables)
  onCreateRef.current = onCreateImageMentionables

  useEffect(() => {
    let active = true
    const unregister = editor.registerCommand(
      DRAG_DROP_PASTE, // dispatched in RichTextPlugin
      (files) => {
        ;(async () => {
          const images = files
            .filter((file) => file.type.startsWith('image/'))
            .slice(0, MAX_MENTIONABLE_IMAGES)
          const { images: mentionableImages, rejected } =
            await convertFilesToMentionableImages(images)
          if (!active) return
          if (rejected.length > 0) {
            new Notice('One or more images could not be attached')
          }
          onCreateRef.current?.(mentionableImages)
        })().catch(() => {
          if (active) new Notice('Unable to attach images')
        })
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
    return () => {
      active = false
      unregister()
    }
  }, [editor])

  return null
}

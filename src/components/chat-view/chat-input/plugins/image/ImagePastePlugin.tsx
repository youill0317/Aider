import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_HIGH, PASTE_COMMAND, PasteCommandType } from 'lexical'
import { Notice } from 'obsidian'
import { useEffect, useRef } from 'react'

import {
  MAX_MENTIONABLE_IMAGES,
  MentionableImage,
} from '../../../../../types/mentionable'
import { convertFilesToMentionableImages } from '../../../../../utils/llm/image'

export default function ImagePastePlugin({
  onCreateImageMentionables,
}: {
  onCreateImageMentionables?: (mentionables: MentionableImage[]) => void
}) {
  const [editor] = useLexicalComposerContext()
  const onCreateRef = useRef(onCreateImageMentionables)
  onCreateRef.current = onCreateImageMentionables

  useEffect(() => {
    let active = true
    const handlePaste = (event: PasteCommandType) => {
      const clipboardData =
        event instanceof ClipboardEvent ? event.clipboardData : null
      if (!clipboardData) return false

      const images = Array.from(clipboardData.files)
        .filter((file) => file.type.startsWith('image/'))
        .slice(0, MAX_MENTIONABLE_IMAGES)
      if (images.length === 0) return false

      convertFilesToMentionableImages(images)
        .then(({ images: mentionableImages, rejected }) => {
          if (!active) return
          if (rejected.length > 0) {
            new Notice('One or more images could not be attached')
          }
          onCreateRef.current?.(mentionableImages)
        })
        .catch(() => {
          if (active) new Notice('Unable to attach images')
        })
      return true
    }

    const unregister = editor.registerCommand(
      PASTE_COMMAND,
      handlePaste,
      COMMAND_PRIORITY_HIGH,
    )
    return () => {
      active = false
      unregister()
    }
  }, [editor])

  return null
}

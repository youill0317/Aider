import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from 'lexical'
import { Platform } from 'obsidian'
import { useEffect } from 'react'

export function createOnEnterHandler(
  onEnter: (evt: KeyboardEvent) => void,
  onVaultChat: (() => void) | undefined,
  isMobile: boolean,
  isMacOS: boolean,
) {
  return (evt: KeyboardEvent) => {
    if (evt.isComposing) return false

    if (onVaultChat && evt.shiftKey && (isMacOS ? evt.metaKey : evt.ctrlKey)) {
      evt.preventDefault()
      evt.stopPropagation()
      onVaultChat()
      return true
    }
    if (evt.shiftKey || (isMobile && !evt.ctrlKey && !evt.metaKey)) {
      return false
    }
    evt.preventDefault()
    evt.stopPropagation()
    onEnter(evt)
    return true
  }
}

export default function OnEnterPlugin({
  onEnter,
  onVaultChat,
}: {
  onEnter: (evt: KeyboardEvent) => void
  onVaultChat?: () => void
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const removeListener = editor.registerCommand(
      KEY_ENTER_COMMAND,
      createOnEnterHandler(
        onEnter,
        onVaultChat,
        Platform.isMobile,
        Platform.isMacOS,
      ),
      COMMAND_PRIORITY_LOW,
    )

    return () => {
      removeListener()
    }
  }, [editor, onEnter, onVaultChat])

  return null
}

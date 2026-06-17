import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from 'lexical'
import { Platform } from 'obsidian'
import { useEffect } from 'react'

export default function OnEnterPlugin({
  onEnter,
  onAgentChat,
  onVaultChat,
}: {
  onEnter: (evt: KeyboardEvent) => void
  onAgentChat?: () => void
  onVaultChat?: () => void
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const removeListener = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (evt: KeyboardEvent) => {
        if (
          onVaultChat &&
          evt.shiftKey &&
          (Platform.isMacOS ? evt.metaKey : evt.ctrlKey)
        ) {
          evt.preventDefault()
          evt.stopPropagation()
          onVaultChat()
          return true
        }
        if (
          onAgentChat &&
          !evt.shiftKey &&
          (Platform.isMacOS ? evt.metaKey : evt.ctrlKey)
        ) {
          evt.preventDefault()
          evt.stopPropagation()
          onAgentChat()
          return true
        }
        if (evt.shiftKey) {
          return false
        }
        evt.preventDefault()
        evt.stopPropagation()
        onEnter(evt)
        return true
      },
      COMMAND_PRIORITY_LOW,
    )

    return () => {
      removeListener()
    }
  }, [editor, onAgentChat, onEnter, onVaultChat])

  return null
}

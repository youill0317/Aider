import { SerializedEditorState, SerializedLexicalNode } from 'lexical'

import { Mentionable } from '../../../../types/mentionable'

export function editorStateToPlainText(
  editorState: SerializedEditorState,
): string {
  return lexicalNodeToPlainText(editorState.root)
}

export function hasSubmittableContent(
  editorState: SerializedEditorState,
  mentionables: Mentionable[],
): boolean {
  return (
    editorStateToPlainText(editorState).trim().length > 0 ||
    mentionables.some((mentionable) => mentionable.type !== 'current-file')
  )
}

function lexicalNodeToPlainText(node: SerializedLexicalNode): string {
  if ('children' in node) {
    const separator = node.type === 'root' ? '\n' : ''
    return (node.children as SerializedLexicalNode[])
      .map(lexicalNodeToPlainText)
      .join(separator)
  } else if (node.type === 'linebreak') {
    return '\n'
  } else if ('text' in node && typeof node.text === 'string') {
    return node.text
  }
  return ''
}

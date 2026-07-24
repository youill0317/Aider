import {
  SerializedEditorState,
  SerializedElementNode,
  SerializedParagraphNode,
  SerializedTextNode,
} from 'lexical'

import {
  editorStateToPlainText,
  hasSubmittableContent,
} from './editor-state-to-plain-text'

describe('editorStateToPlainText', () => {
  it('should convert editor state to plain text', () => {
    const editorState: SerializedEditorState = {
      root: {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'Hello, world!',
                type: 'text',
                version: 1,
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'paragraph',
            version: 1,
            textFormat: 0,
            textStyle: '',
          } as SerializedElementNode<SerializedTextNode>,
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    }
    const plainText = editorStateToPlainText(editorState)
    expect(plainText).toBe('Hello, world!')
  })

  it('allows explicit context but not the automatic current file alone', () => {
    const emptyEditorState: SerializedEditorState = {
      root: {
        children: [],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    }

    expect(
      hasSubmittableContent(emptyEditorState, [
        { type: 'current-file', file: null },
      ]),
    ).toBe(false)
    expect(
      hasSubmittableContent(emptyEditorState, [
        { type: 'image', name: 'note.png', mimeType: 'image/png', data: '' },
      ]),
    ).toBe(true)
  })

  it('preserves boundaries between paragraphs', () => {
    const paragraph = (text: string): SerializedParagraphNode => ({
      children: [
        {
          detail: 0,
          format: 0,
          mode: 'normal' as const,
          style: '',
          text,
          type: 'text' as const,
          version: 1,
        } as SerializedTextNode,
      ],
      direction: 'ltr' as const,
      format: '',
      indent: 0,
      type: 'paragraph' as const,
      version: 1,
      textFormat: 0,
      textStyle: '',
    })

    const editorState: SerializedEditorState = {
      root: {
        children: [paragraph('First'), paragraph('Second')],
        direction: 'ltr' as const,
        format: '',
        indent: 0,
        type: 'root' as const,
        version: 1,
      },
    }

    expect(editorStateToPlainText(editorState)).toBe('First\nSecond')
  })

  it('treats Lexical empty paragraphs as empty content', () => {
    const editorState: SerializedEditorState = {
      root: {
        children: [
          {
            children: [],
            direction: null,
            format: '',
            indent: 0,
            type: 'paragraph',
            version: 1,
            textFormat: 0,
            textStyle: '',
          } as SerializedParagraphNode,
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    }

    expect(editorStateToPlainText(editorState).trim()).toBe('')
  })
})

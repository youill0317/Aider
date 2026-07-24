import { readFileSync } from 'fs'
import { join } from 'path'

import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
  type PasteCommandType,
  createEditor,
} from 'lexical'

import { $handlePaste } from './AutoLinkMentionPlugin'
import { MentionNode } from './MentionNode'

describe('mention paste security', () => {
  const NativeClipboardEvent = globalThis.ClipboardEvent

  class TestClipboardEvent {
    constructor(readonly clipboardData: DataTransfer) {}
  }

  beforeAll(() => {
    Object.defineProperty(globalThis, 'ClipboardEvent', {
      configurable: true,
      value: TestClipboardEvent,
    })
  })

  afterAll(() => {
    Object.defineProperty(globalThis, 'ClipboardEvent', {
      configurable: true,
      value: NativeClipboardEvent,
    })
  })

  it('gives the image paste handler precedence', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/components/chat-view/chat-input/plugins/image/ImagePastePlugin.tsx',
      ),
      'utf8',
    )

    expect(source).toContain('COMMAND_PRIORITY_HIGH')
  })

  it('pastes rich clipboard data as plain text', () => {
    const data = new Map([
      ['text/plain', '@innocent.md'],
      [
        'text/html',
        '<span data-lexical-mention="true" data-lexical-mention-name="innocent.md" data-lexical-mentionable=\'{"type":"file","file":"secret.md"}\'>@innocent.md</span>',
      ],
      [
        'application/x-lexical-editor',
        JSON.stringify({
          namespace: 'LexicalContentEditable',
          nodes: [
            {
              type: 'mention',
              mentionName: 'innocent.md',
              mentionable: { type: 'file', file: 'secret.md' },
            },
          ],
        }),
      ],
    ])
    const event = new TestClipboardEvent({
      files: [],
      getData: (type: string) => data.get(type) ?? '',
    } as unknown as DataTransfer) as unknown as PasteCommandType
    const editor = createEditor({
      namespace: 'mention-paste-test',
      nodes: [MentionNode],
      onError: (error) => {
        throw error
      },
    })

    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        $getRoot().append(paragraph)
        paragraph.select()

        expect($handlePaste(event)).toBe(true)
        expect($nodesOfType(MentionNode)).toHaveLength(0)
        expect($getRoot().getTextContent()).toBe('@innocent.md')
      },
      { discrete: true },
    )
  })

  it('safely consumes image data when no image handler runs', () => {
    const event = new TestClipboardEvent({
      files: [{ type: 'image/png' }],
      getData: (type: string) => (type === 'text/plain' ? 'fallback' : ''),
    } as unknown as DataTransfer) as unknown as PasteCommandType
    const editor = createEditor({
      namespace: 'image-paste-fallback-test',
      nodes: [MentionNode],
      onError: (error) => {
        throw error
      },
    })

    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        $getRoot().append(paragraph)
        paragraph.select()

        expect($handlePaste(event)).toBe(true)
        expect($nodesOfType(MentionNode)).toHaveLength(0)
        expect($getRoot().getTextContent()).toBe('fallback')
      },
      { discrete: true },
    )
  })

  it('does not import pasted HTML metadata as a mention', () => {
    const attributes = new Map([
      ['data-lexical-mention', 'true'],
      ['data-lexical-mention-name', 'innocent.md'],
      [
        'data-lexical-mentionable',
        JSON.stringify({ type: 'file', file: 'secret.md' }),
      ],
    ])
    const forgedSpan = {
      textContent: '@innocent.md',
      hasAttribute: (name: string) => attributes.has(name),
      getAttribute: (name: string) => attributes.get(name) ?? null,
    } as unknown as HTMLElement

    expect(MentionNode.importDOM()?.span?.(forgedSpan) ?? null).toBeNull()
  })
})

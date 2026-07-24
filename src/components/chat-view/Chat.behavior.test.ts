import * as fs from 'fs'
import * as path from 'path'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/chat-view/Chat.tsx'),
  'utf8',
)

describe('Chat behavior contract', () => {
  it('defers full-history saves while prompt, stream, or agent work is active', () => {
    expect(source).toContain('const hasActiveWork =')
    expect(source).toContain('submitChatMutation.isPending')
    expect(source).toContain('activeAgentToolCallCount > 0')
    expect(source).toContain('chatMessages.length > 0 && !hasActiveWork')
    expect(source).toContain('await flushPendingSave()')
  })

  it('keeps the draft until submission setup succeeds', () => {
    expect(source).toContain('return handleUserMessageSubmit({')
    expect(source).toContain('.then((submitted) => {')
    expect(source).toContain('if (submitted) {')
    expect(source).toContain('setInputMessage(getNewInputMessage(app))')
  })

  it('persists an accepted user turn before starting remote work', () => {
    expect(
      source.match(
        /createOrUpdateConversation\(conversationId, compiledMessages\)/g,
      ),
    ).toHaveLength(2)
    expect(
      source.match(/await flushPendingChatSave\(\)/g)?.length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('keeps idle current selection inert but lets it cancel another load', () => {
    expect(source).toContain(
      'conversationId === loadingConversationIdRef.current',
    )
    expect(source).toContain(
      'conversationId === currentConversationIdRef.current &&',
    )
    expect(source).toContain('loadingConversationIdRef.current === null')
    expect(source).toContain(
      'loadingConversationIdRef.current = conversationId',
    )
  })

  it('cancels and generation-guards apply requests', () => {
    expect(source).toContain('activeApplyControllerRef.current?.abort()')
    expect(source).toContain('signal: abortController.signal')
    expect(
      source.match(/!isCurrentWork\(generation, conversationId\)/g)?.length,
    ).toBeGreaterThanOrEqual(3)
  })

  it('refreshes current-file context when edit focus changes', () => {
    expect(source).toContain('handleActiveLeafChange()')
    expect(source).not.toContain('if (!activeFile) return')
  })
})

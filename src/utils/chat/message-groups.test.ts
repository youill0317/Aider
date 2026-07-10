import type { ChatMessage } from '../../types/chat'

import { buildChatMessageRows } from './message-groups'

test('builds grouped rows with source message boundaries', () => {
  const messages = [
    { role: 'user', id: 'user-1', content: null, mentionables: [] },
    { role: 'assistant', id: 'assistant-1', content: 'first' },
    { role: 'tool', id: 'tool-1', toolCalls: [] },
    { role: 'assistant', id: 'assistant-2', content: 'second' },
    { role: 'user', id: 'user-2', content: null, mentionables: [] },
  ] as ChatMessage[]

  const rows = buildChatMessageRows(messages)

  expect(rows.map((row) => row.endIndex)).toEqual([1, 4, 5])
  expect(rows[0].messageOrGroup).toBe(messages[0])
  expect(rows[1].messageOrGroup).toEqual(messages.slice(1, 4))
  expect(rows[2].messageOrGroup).toBe(messages[4])
})

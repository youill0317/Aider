import type { RequestMessage } from '../../types/llm/request'

import { formatMessages } from './request'

describe('formatMessages', () => {
  it('keeps consecutive tool results correlated to their calls', () => {
    const messages: RequestMessage[] = [
      {
        role: 'tool',
        tool_call: { id: 'call-1', name: 'first' },
        content: 'first result',
      },
      {
        role: 'tool',
        tool_call: { id: 'call-2', name: 'second' },
        content: 'second result',
      },
    ]

    expect(formatMessages(messages)).toEqual(messages)
  })
})

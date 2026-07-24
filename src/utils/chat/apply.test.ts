import type { TFile } from 'obsidian'

import type { BaseLLMProvider } from '../../core/llm/base'
import type { ChatModel } from '../../types/chat-model.types'
import type { LLMProvider } from '../../types/provider.types'

import { applyChangesToFile } from './apply'

const model = {
  id: 'model',
  model: 'test-model',
} as ChatModel
const file = {
  path: 'note.md',
} as TFile

function providerReturning(content: string) {
  return {
    generateResponse: jest.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
  } as unknown as BaseLLMProvider<LLMProvider>
}

describe('applyChangesToFile', () => {
  test.each([
    ['```md\na\n```\n', 'a\n'],
    [' \n```note.md\r\na\r\nb\r\n```\r\n\r\n', 'a\r\nb\r\n'],
    ['```\n```', ''],
    ['```\n\n```', '\n'],
    ['plain response\n', 'plain response\n'],
    ['prefix\n```\na\n```', 'prefix\n```\na\n```'],
  ])('extracts a complete fenced response %j', async (response, expected) => {
    await expect(
      applyChangesToFile({
        blockToApply: 'change',
        currentFile: file,
        currentFileContent: 'before',
        chatMessages: [],
        providerClient: providerReturning(response),
        model,
      }),
    ).resolves.toBe(expected)
  })

  it('forwards cancellation to the provider', async () => {
    const providerClient = providerReturning('updated')
    const generateResponse = (
      providerClient as unknown as { generateResponse: jest.Mock }
    ).generateResponse
    const controller = new AbortController()

    await applyChangesToFile({
      blockToApply: 'change',
      currentFile: file,
      currentFileContent: 'before',
      chatMessages: [],
      providerClient,
      model,
      signal: controller.signal,
    })

    expect(generateResponse).toHaveBeenCalledWith(model, expect.any(Object), {
      signal: controller.signal,
    })
  })
})

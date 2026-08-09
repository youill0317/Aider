import { GeminiProvider } from './gemini'

describe('GeminiProvider usage parsing', () => {
  it('counts thinking tokens as billed output in both response modes', () => {
    const response = {
      candidates: [],
      text: '',
      usageMetadata: {
        promptTokenCount: 10,
        toolUsePromptTokenCount: 5,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 30,
        totalTokenCount: 65,
      },
    } as unknown as Parameters<
      typeof GeminiProvider.parseNonStreamingResponse
    >[0]

    expect(
      GeminiProvider.parseNonStreamingResponse(response, 'model', 'id').usage,
    ).toEqual({ prompt_tokens: 15, completion_tokens: 50, total_tokens: 65 })
    expect(
      GeminiProvider.parseStreamingResponseChunk(response, 'model', 'id').usage,
    ).toEqual({ prompt_tokens: 15, completion_tokens: 50, total_tokens: 65 })
  })
})

import { NoStainlessOpenAI } from './NoStainlessOpenAI'
import { OllamaProvider } from './ollama'

describe('Ollama request headers', () => {
  it('does not send OpenAI credentials or client metadata', async () => {
    const provider = new OllamaProvider({
      type: 'ollama',
      id: 'ollama',
      apiKey: 'ollama-secret',
    })
    const client = (
      provider as unknown as {
        client: NoStainlessOpenAI
      }
    ).client

    const { req } = await client.buildRequest({
      method: 'post',
      path: '/chat/completions',
      body: {},
    } as never)
    const headers = new Headers(req.headers)
    let hasStainlessHeader = false
    headers.forEach((_value, key) => {
      if (key.startsWith('x-stainless')) hasStainlessHeader = true
    })

    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('user-agent')).toBeNull()
    expect(hasStainlessHeader).toBe(false)
  })
})

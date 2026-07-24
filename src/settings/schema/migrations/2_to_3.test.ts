import {
  NEW_DEFAULT_CHAT_MODELS,
  NEW_DEFAULT_PROVIDERS,
  migrateFrom2To3,
} from './2_to_3'

describe('settings 2_to_3 migration', () => {
  it('should add new default providers when no providers exist', () => {
    const oldSettings = {
      version: 2,
      providers: [],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.version).toBe(3)
    expect(result.providers).toEqual(NEW_DEFAULT_PROVIDERS)
  })

  it('should preserve existing providers and add new ones', () => {
    const oldSettings = {
      version: 2,
      providers: [
        {
          type: 'openai',
          id: 'openai',
          apiKey: 'test-key',
        },
      ],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.version).toBe(3)
    expect(result.providers).toEqual([
      {
        type: 'openai',
        id: 'openai',
        apiKey: 'test-key',
      },
      ...NEW_DEFAULT_PROVIDERS,
    ])
    expect(result.providers).toHaveLength(4) // 1 existing + 3 new
  })

  it('should preserve a custom provider that collides with a new default ID', () => {
    const customProvider = {
      type: 'openai-compatible',
      id: 'morph',
      apiKey: 'test-key',
    }
    const oldSettings = {
      version: 2,
      providers: [customProvider],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.version).toBe(3)
    expect(
      (result.providers as { id: string }[]).filter(({ id }) => id === 'morph'),
    ).toEqual([customProvider])
  })

  it('should handle missing providers array', () => {
    const oldSettings = {
      version: 2,
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.version).toBe(3)
    expect(result).toEqual({
      version: 3,
    })
  })

  it('should add new chat models when no chat models exist', () => {
    const oldSettings = {
      version: 2,
      providers: [],
      chatModels: [],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.chatModels).toEqual(NEW_DEFAULT_CHAT_MODELS)
  })

  it('should preserve existing chat models and add new ones', () => {
    const oldSettings = {
      version: 2,
      providers: [],
      chatModels: [
        {
          providerType: 'openai',
          providerId: 'openai',
          id: 'gpt-4',
          model: 'gpt-4',
        },
      ],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.chatModels).toEqual([
      {
        providerType: 'openai',
        providerId: 'openai',
        id: 'gpt-4',
        model: 'gpt-4',
      },
      ...NEW_DEFAULT_CHAT_MODELS,
    ])
  })

  it('should preserve a custom model that collides with a new default ID', () => {
    const customModel = {
      providerType: 'openai',
      providerId: 'custom',
      id: 'deepseek-chat',
      model: 'custom-model',
    }
    const oldSettings = {
      version: 2,
      providers: [],
      chatModels: [customModel],
      chatModelId: 'deepseek-chat',
    }

    const result = migrateFrom2To3(oldSettings)
    expect(
      (result.chatModels as { id: string }[]).filter(
        ({ id }) => id === 'deepseek-chat',
      ),
    ).toEqual([customModel])
    expect(result.chatModelId).toBe('deepseek-chat')
  })
})

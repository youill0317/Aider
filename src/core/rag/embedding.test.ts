import {
  SmartComposerSettings,
  smartComposerSettingsSchema,
} from '../../settings/schema/setting.types'
import { getProviderClient } from '../llm/manager'

import { getEmbeddingModelClient } from './embedding'

jest.mock('../llm/manager', () => ({
  getProviderClient: jest.fn(),
}))

const getProviderClientMock = jest.mocked(getProviderClient)

it('forwards abort signals to standard and contextual embedding providers', async () => {
  const getEmbedding = jest.fn().mockResolvedValue([0.1, 0.2])
  const getContextualEmbeddings = jest.fn().mockResolvedValue({
    chunks: [{ embedding: [0.3, 0.4], text: 'chunk' }],
  })
  getProviderClientMock.mockReturnValue({
    getEmbedding,
    getContextualEmbeddings,
  } as unknown as ReturnType<typeof getProviderClient>)
  const settings: SmartComposerSettings = {
    ...smartComposerSettingsSchema.parse({}),
    embeddingModels: [
      {
        providerType: 'voyage',
        providerId: 'voyage',
        id: 'voyage/voyage-4',
        model: 'voyage-4',
        dimension: 512,
        outputDimension: 512,
      },
      {
        providerType: 'voyage',
        providerId: 'voyage',
        id: 'voyage/voyage-context-4',
        model: 'voyage-context-4',
        dimension: 1024,
      },
    ],
  }
  const controller = new AbortController()

  const standardClient = getEmbeddingModelClient({
    settings,
    embeddingModelId: 'voyage/voyage-4',
  })
  await standardClient.getEmbedding('standard', controller.signal)
  const contextualClient = getEmbeddingModelClient({
    settings,
    embeddingModelId: 'voyage/voyage-context-4',
  })
  await contextualClient.getContextualEmbeddings?.('contextual', {
    inputType: 'document',
    signal: controller.signal,
  })

  expect(getEmbedding).toHaveBeenCalledWith('voyage-4', 'standard', {
    dimensions: 512,
    signal: controller.signal,
  })
  expect(getContextualEmbeddings).toHaveBeenCalledWith(
    'voyage-context-4',
    'contextual',
    {
      dimensions: undefined,
      inputType: 'document',
      signal: controller.signal,
    },
  )
})

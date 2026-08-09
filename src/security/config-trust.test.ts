import { McpServerConfig } from '../types/mcp.types'
import { LLMProvider } from '../types/provider.types'

import {
  assertProviderRouteTrusted,
  isMcpServerTrusted,
  loadProviderRouteTrust,
  revokeMcpServerTrust,
  revokeProviderRouteTrust,
  trustMcpServer,
  trustProviderRoute,
} from './config-trust'
import type { SecretStore } from './secret-store/secret-store'

describe('device-local configuration trust', () => {
  it('binds MCP trust to command, arguments, environment, and tool options', async () => {
    const secretStore = createMemorySecretStore()
    const config: McpServerConfig = {
      id: 'trust-test-server',
      enabled: true,
      parameters: {
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'secret' },
      },
      toolOptions: {},
    }

    await expect(isMcpServerTrusted(config, secretStore)).resolves.toBe(false)
    await trustMcpServer(config, secretStore)
    await expect(isMcpServerTrusted(config, secretStore)).resolves.toBe(true)
    await expect(
      isMcpServerTrusted(
        {
          ...config,
          toolOptions: { tool: { allowAutoExecution: true, disabled: false } },
        },
        secretStore,
      ),
    ).resolves.toBe(false)

    const trustedToolOptions = {
      first: { disabled: true, allowAutoExecution: false },
      second: { allowAutoExecution: true },
    }
    await trustMcpServer(
      { ...config, toolOptions: trustedToolOptions },
      secretStore,
    )
    await expect(
      isMcpServerTrusted(
        {
          ...config,
          toolOptions: {
            second: { allowAutoExecution: true },
            first: { allowAutoExecution: false, disabled: true },
          },
        },
        secretStore,
      ),
    ).resolves.toBe(true)

    await trustMcpServer(config, secretStore)

    for (const parameters of [
      { ...config.parameters, command: 'sh' },
      { ...config.parameters, args: ['other.js'] },
      { ...config.parameters, env: { OTHER: 'secret' } },
      { ...config.parameters, env: { TOKEN: 'changed' } },
    ]) {
      await expect(
        isMcpServerTrusted({ ...config, parameters }, secretStore),
      ).resolves.toBe(false)
    }

    await revokeMcpServerTrust(config.id, secretStore)
    await expect(isMcpServerTrusted(config, secretStore)).resolves.toBe(false)
  })

  it('blocks changed custom provider routes until explicitly trusted', async () => {
    const secretStore = createMemorySecretStore()
    const provider: LLMProvider = {
      id: 'trust-test-provider',
      type: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      apiKey: 'secret',
    }

    await expect(loadProviderRouteTrust(provider, secretStore)).resolves.toBe(
      false,
    )
    expect(() => assertProviderRouteTrusted(provider)).toThrow(
      'requires review',
    )

    await trustProviderRoute(provider, secretStore)
    expect(() => assertProviderRouteTrusted(provider)).not.toThrow()
    expect(() =>
      assertProviderRouteTrusted({
        ...provider,
        baseUrl: 'https://changed.example/v1',
      }),
    ).toThrow('requires review')

    const changedProvider = {
      ...provider,
      baseUrl: 'https://changed.example/v1',
    }
    await trustProviderRoute(changedProvider, secretStore)
    expect(() => assertProviderRouteTrusted(changedProvider)).not.toThrow()
    expect(() => assertProviderRouteTrusted(provider)).toThrow(
      'requires review',
    )

    await revokeProviderRouteTrust(changedProvider, secretStore)
    expect(() => assertProviderRouteTrusted(changedProvider)).toThrow(
      'requires review',
    )
    await expect(
      loadProviderRouteTrust(changedProvider, secretStore),
    ).resolves.toBe(false)
  })

  it('allows built-in provider routes without a custom endpoint', () => {
    expect(() =>
      assertProviderRouteTrusted({ id: 'openai-default', type: 'openai' }),
    ).not.toThrow()
  })
})

function createMemorySecretStore(): SecretStore {
  const values = new Map<string, string>()
  return {
    getBackendStatus: () => 'memory-only-fallback',
    getSecret: async (key) => values.get(key) ?? null,
    setSecret: async (key, value) => {
      values.set(key, value)
    },
    deleteSecret: async (key) => {
      values.delete(key)
    },
  }
}

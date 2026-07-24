import { migrateFrom16To17 } from './16_to_17'

describe('Migration from v16 to v17', () => {
  it('should increment version to 17', () => {
    const oldSettings = {
      version: 16,
    }

    const result = migrateFrom16To17(oldSettings)

    expect(result.version).toBe(17)
  })

  it('should add default Codex agent settings', () => {
    const oldSettings = {
      version: 16,
    }

    const result = migrateFrom16To17(oldSettings)

    expect(result.agent).toEqual({
      codex: {
        enabled: true,
        command: 'codex',
        defaultSandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        cwdMode: 'vault',
        customCwd: '',
        resume: true,
      },
    })
  })

  it('should preserve existing Codex agent settings', () => {
    const oldSettings = {
      version: 16,
      agent: {
        codex: {
          enabled: false,
          command: 'custom-codex',
          defaultSandbox: 'read-only',
          approvalPolicy: 'on-request',
          cwdMode: 'custom',
          customCwd: '/tmp/vault',
          resume: false,
          extraArgs: ['--profile', 'work'],
          webSearch: 'disabled',
        },
      },
    }

    const result = migrateFrom16To17(oldSettings)

    expect(result.agent).toEqual({
      codex: {
        enabled: false,
        command: 'custom-codex',
        defaultSandbox: 'read-only',
        approvalPolicy: 'on-request',
        cwdMode: 'custom',
        customCwd: '/tmp/vault',
        resume: false,
      },
    })
  })

  it('should normalize legacy default approval to on-request', () => {
    const result = migrateFrom16To17({
      version: 16,
      agent: {
        codex: {
          approvalPolicy: 'default',
        },
      },
    })

    expect(
      (result.agent as { codex: { approvalPolicy: unknown } }).codex
        .approvalPolicy,
    ).toBe('on-request')
  })

  it('should preserve provider, chat, and MCP values', () => {
    const oldSettings = {
      version: 16,
      providers: [{ type: 'custom', id: 'custom-provider' }],
      chatModels: [
        {
          id: 'custom-model',
          providerType: 'custom',
          providerId: 'custom-provider',
          model: 'custom-model',
        },
      ],
      chatModelId: 'custom-model',
      mcp: {
        servers: [
          {
            name: 'local',
            command: 'node',
            args: ['server.js'],
          },
        ],
      },
    }

    const result = migrateFrom16To17(oldSettings)

    expect(result.providers).toEqual(oldSettings.providers)
    expect(result.chatModels).toEqual(oldSettings.chatModels)
    expect(result.chatModelId).toBe(oldSettings.chatModelId)
    expect(result.mcp).toEqual(oldSettings.mcp)
  })
})

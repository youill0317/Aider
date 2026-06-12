import * as fs from 'fs'
import * as path from 'path'

import { createMcpManagerTestHarness } from '../../core/mcp/mcp-permissions.test-utils'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { getRedactedErrorModalProps } from './ErrorModal'

describe('redaction integration boundaries', () => {
  it('ErrorModal receives redacted log text', () => {
    // Given: an actionable error modal log includes an authorization header.
    const props = getRedactedErrorModalProps({
      message: 'Provider request failed',
      log: 'request failed with Authorization: Bearer sk-test-secret',
    })

    // When/Then: the modal props preserve context without the raw token.
    expect(props.message).toBe('Provider request failed')
    expect(props.log).toContain('[REDACTED]')
    expect(props.log).not.toContain('sk-test-secret')
  })

  it('chat stream notice omits bearer token', () => {
    // Given: a chat stream error message carries a bearer token.
    const props = getRedactedErrorModalProps({
      message: 'Authorization: Bearer secret',
      log: undefined,
    })

    // When/Then: the displayed message omits the bearer token.
    expect(props.message).toBe('Authorization: Bearer [REDACTED]')
    expect(props.message).not.toContain('Bearer secret')
  })

  it('OAuth error omits authorization code', () => {
    // Given: an OAuth error detail includes a code-shaped secret field.
    const props = getRedactedErrorModalProps({
      message: 'OAuth failed',
      log: JSON.stringify({ code: 'oauth-code-secret', status: 400 }),
    })

    // When/Then: the authorization code is not shown in the log payload.
    expect(props.log).toContain('[REDACTED]')
    expect(props.log).not.toContain('oauth-code-secret')
    expect(props.log).toContain('400')
  })

  it('MCP error omits configured env secret', async () => {
    // Given: an MCP server has an env secret and its tool returns that secret in an error.
    const envSecret = 'GITHUB_PERSONAL_ACCESS_TOKEN_VALUE'
    const manager = createMcpManagerTestHarness({
      servers: [
        {
          id: 'github',
          enabled: true,
          parameters: {
            command: 'node',
            args: ['server.js'],
            env: {
              GITHUB_PERSONAL_ACCESS_TOKEN: envSecret,
            },
          },
          toolOptions: {
            search: {
              allowAutoExecution: true,
            },
          },
        },
      ],
      connectedTools: [
        {
          serverName: 'github',
          toolName: 'search',
          callResult: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `failed with ${envSecret}`,
              },
            ],
          },
        },
      ],
    })

    // When: the tool error is returned through MCP manager.
    const result = await manager.callTool({ name: 'github__search' })

    // Then: the configured env secret is redacted from the result error.
    expect(result.status).toBe(ToolCallResponseStatus.Error)
    if (result.status === ToolCallResponseStatus.Error) {
      expect(result.error).toContain('[REDACTED]')
      expect(result.error).not.toContain(envSecret)
    }
  })

  it('tool result error omits secret value', async () => {
    // Given: a tool result includes a bearer token in its error text.
    const manager = createMcpManagerTestHarness({
      servers: [
        {
          id: 'github',
          enabled: true,
          parameters: {
            command: 'node',
            args: ['server.js'],
          },
          toolOptions: {
            search: {
              allowAutoExecution: true,
            },
          },
        },
      ],
      connectedTools: [
        {
          serverName: 'github',
          toolName: 'search',
          callResult: {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Authorization: Bearer tool-secret-value',
              },
            ],
          },
        },
      ],
    })

    // When: the tool error is returned through MCP manager.
    const result = await manager.callTool({ name: 'github__search' })

    // Then: bearer token contents are redacted from the tool error.
    expect(result.status).toBe(ToolCallResponseStatus.Error)
    if (result.status === ToolCallResponseStatus.Error) {
      expect(result.error).toBe('Authorization: Bearer [REDACTED]')
    }
  })

  it('chat and apply error notice paths redact diagnostics', () => {
    // Given: generic Notice and console branches can display raw errors.
    const chatSource = readProjectFile(
      'src/components/chat-view/useChatStreamManager.ts',
    )
    const applySource = readProjectFile('src/components/chat-view/Chat.tsx')

    // When/Then: both branches redact notice messages and console payloads.
    expect(chatSource).toContain('new Notice(redactSecrets(error.message))')
    expect(chatSource).toContain(
      "console.error('Failed to generate response', redactSecrets(error))",
    )
    expect(applySource).toContain('new Notice(redactSecrets(error.message))')
    expect(applySource).toContain(
      "console.error('Failed to apply changes', redactSecrets(error))",
    )
  })

  it('Gemini project errors redact access-token diagnostics', () => {
    // Given: Gemini project helpers call endpoints with bearer tokens.
    const source = readProjectFile('src/core/llm/geminiProject.ts')

    // When/Then: caught errors pass through the token-aware redaction helper.
    expect(source).toContain('redactGeminiProjectError(error, accessToken)')
    expect(source).not.toContain(
      "console.error('Failed to load Gemini managed project:', error)",
    )
    expect(source).not.toContain(
      "console.error('Failed to onboard Gemini managed project:', error)",
    )
  })
})

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

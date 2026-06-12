import * as fs from 'fs'
import * as path from 'path'

import { mcpServerParametersSchema } from '../types/mcp.types'

describe('Windows native compatibility guardrails', () => {
  it('MCP parameters remain argv array', () => {
    // Given: a Windows-native MCP command with argv-style arguments.
    const parsed = mcpServerParametersSchema.parse({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Users\\me\\server.js', '--flag=value'],
      env: {
        NORMAL_FLAG: 'debug',
      },
    })

    // When/Then: command and args stay structured, not shell-joined.
    expect(parsed.command).toBe('C:\\Program Files\\nodejs\\node.exe')
    expect(parsed.args).toEqual(['C:\\Users\\me\\server.js', '--flag=value'])
  })

  it('OAuth redirect requires explicit port', async () => {
    // Given: OAuth helpers receive localhost redirects without explicit ports.
    const { startCodexCallbackServer, stopCodexCallbackServer } = await import(
      '../core/llm/codexAuth'
    )
    const { startGeminiCallbackServer, stopGeminiCallbackServer } =
      await import('../core/llm/geminiAuth')

    // When/Then: helpers reject before binding a listener.
    await expect(
      startCodexCallbackServer({
        state: 'state',
        redirectUri: 'http://localhost/auth/callback',
        timeoutMs: 10,
      }),
    ).rejects.toThrow('Codex redirect URI must include an explicit port')
    await expect(
      startGeminiCallbackServer({
        state: 'state',
        redirectUri: 'http://localhost/oauth2callback',
        timeoutMs: 10,
      }),
    ).rejects.toThrow('Gemini redirect URI must include an explicit port')
    await stopCodexCallbackServer()
    await stopGeminiCallbackServer()
  })

  it('no POSIX shell wrapper is required', () => {
    // Given: MCP manager source should use StdioClientTransport parameters.
    const source = readProjectFile('src/core/mcp/mcpManager.ts')

    // When/Then: no shell-string wrapper is introduced around MCP commands.
    expect(source).toContain('new StdioClientTransport({')
    expect(source).not.toContain('shell: true')
    expect(source).not.toContain('/bin/sh')
    expect(source).not.toContain('cmd.exe')
  })

  it('Obsidian secret backend does not require native dependencies', () => {
    // Given: package dependencies define runtime requirements.
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    }

    // When/Then: no native keychain dependency is required.
    expect(dependencies).not.toHaveProperty('keytar')
    expect(dependencies).not.toHaveProperty('@napi-rs/keyring')
    expect(dependencies).not.toHaveProperty('electron')
  })

  it('Obsidian secret backend does not import electron', () => {
    // Given: secret storage source should depend on Obsidian feature detection.
    const source = readProjectFile('src/security/secret-store/secret-store.ts')

    // When/Then: direct Electron storage APIs are not used.
    expect(source).not.toMatch(/\bfrom ['"]electron['"]/)
    expect(source).not.toContain('safeStorage')
    expect(source).toContain('secretStorage')
  })
})

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

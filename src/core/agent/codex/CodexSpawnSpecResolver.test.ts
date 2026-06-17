import { CodexSpawnSpecResolver } from './CodexSpawnSpecResolver'

describe('CodexSpawnSpecResolver', () => {
  it('resolves codex from an enhanced Windows npm PATH location', () => {
    // Given: Obsidian starts with a minimal PATH but APPDATA points to npm.
    const resolver = new CodexSpawnSpecResolver()
    const existingFiles = new Set([
      'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.exe',
    ])

    // When: a bare Codex command is resolved for Windows.
    const spawnSpec = resolver.resolve(['codex', 'exec', '--json'], {
      env: {
        APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
        PATH: 'C:\\Windows\\System32',
      },
      fileSystem: {
        existsFile: (filePath) => existingFiles.has(filePath),
      },
      pathTools: windowsPathTools,
      platform: 'win32',
    })

    // Then: the concrete executable path is used and PATH includes npm.
    expect(spawnSpec.command).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.exe',
    )
    expect(spawnSpec.args).toEqual(['exec', '--json'])
    expect(spawnSpec.env.PATH).toContain('C:\\Users\\me\\AppData\\Roaming\\npm')
  })

  it('wraps Windows cmd shims through cmd.exe', () => {
    // Given: Codex is installed as an npm .cmd shim on Windows.
    const resolver = new CodexSpawnSpecResolver()
    const existingFiles = new Set([
      'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd',
    ])

    // When: the spawn spec is resolved.
    const spawnSpec = resolver.resolve(
      ['codex', 'exec', '--cd', 'C:\\My Vault'],
      {
        comspec: 'C:\\Windows\\System32\\cmd.exe',
        env: {
          APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
          PATH: '',
        },
        fileSystem: {
          existsFile: (filePath) => existingFiles.has(filePath),
        },
        pathTools: windowsPathTools,
        platform: 'win32',
      },
    )

    // Then: Node does not spawn the .cmd file directly.
    expect(spawnSpec.command).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(spawnSpec.args[0]).toBe('/d')
    expect(spawnSpec.args).toContain('/c')
    expect(spawnSpec.args.join(' ')).toContain('codex.cmd')
    expect(spawnSpec.windowsVerbatimArguments).toBe(true)
  })
})

const windowsPathTools = {
  delimiter: ';',
  dirname: (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, ''),
  join: (...parts: readonly string[]) => parts.filter(Boolean).join('\\'),
}

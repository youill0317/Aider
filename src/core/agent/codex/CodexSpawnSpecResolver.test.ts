import { CodexSpawnSpecResolver } from './CodexSpawnSpecResolver'

describe('CodexSpawnSpecResolver', () => {
  it('passes only the environment needed by Codex', () => {
    const resolver = new CodexSpawnSpecResolver()

    const spawnSpec = resolver.resolve(['codex', 'exec'], {
      env: {
        CODEX_HOME: '/home/me/.codex',
        DATABASE_URL: 'database-secret',
        HOME: '/home/me',
        LANG: 'en_US.UTF-8',
        NODE_OPTIONS: '--require=/tmp/injected.js',
        OPENAI_API_KEY: 'api-secret',
        PATH: '/usr/bin',
        TMPDIR: '/tmp',
      },
      platform: 'linux',
    })

    expect(spawnSpec.env).toEqual(
      expect.objectContaining({
        CODEX_HOME: '/home/me/.codex',
        HOME: '/home/me',
        LANG: 'en_US.UTF-8',
        PATH: expect.stringContaining('/usr/bin'),
        TMPDIR: '/tmp',
      }),
    )
    expect(spawnSpec.env).not.toHaveProperty('DATABASE_URL')
    expect(spawnSpec.env).not.toHaveProperty('NODE_OPTIONS')
    expect(spawnSpec.env).not.toHaveProperty('OPENAI_API_KEY')
  })

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
        SystemRoot: 'C:\\Windows',
        TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
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
    expect(spawnSpec.env).toMatchObject({
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
    })
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
    expect(spawnSpec.args).toEqual([
      '/d',
      '/s',
      '/c',
      '"C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd ^^^"exec^^^" ^^^"--cd^^^" ^^^"C:\\My^^^ Vault^^^""',
    ])
    expect(spawnSpec.windowsVerbatimArguments).toBe(true)
  })

  it.each([
    [
      'environment expansion',
      '%CMDCMDLINE% & echo injected',
      '^^^"^^^%CMDCMDLINE^^^%^^^ ^^^&^^^ echo^^^ injected^^^"',
    ],
    [
      'delayed environment expansion',
      '!ComSpec! | echo injected',
      '^^^"^^^!ComSpec^^^!^^^ ^^^|^^^ echo^^^ injected^^^"',
    ],
    [
      'quote breakout',
      'gpt-5" & echo injected & "',
      '^^^"gpt-5\\^^^"^^^ ^^^&^^^ echo^^^ injected^^^ ^^^&^^^ \\^^^"^^^"',
    ],
  ])(
    'escapes model arguments containing %s payloads',
    (_kind, model, escaped) => {
      const resolver = new CodexSpawnSpecResolver()
      const command = 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd'

      const spawnSpec = resolver.resolve(['codex', 'exec', '--model', model], {
        env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', PATH: '' },
        fileSystem: { existsFile: (filePath) => filePath === command },
        pathTools: windowsPathTools,
        platform: 'win32',
      })

      expect(spawnSpec.args[3]).toBe(
        `"${command} ^^^"exec^^^" ^^^"--model^^^" ${escaped}"`,
      )
    },
  )

  it.each(['gpt\rwhoami', 'gpt\nwhoami', 'gpt\r\nwhoami'])(
    'rejects line breaks in Windows cmd shim arguments',
    (model) => {
      const resolver = new CodexSpawnSpecResolver()
      const command = 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd'

      expect(() =>
        resolver.resolve(['codex', 'exec', '--model', model], {
          env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', PATH: '' },
          fileSystem: { existsFile: (filePath) => filePath === command },
          pathTools: windowsPathTools,
          platform: 'win32',
        }),
      ).toThrow('cannot contain line breaks')
    },
  )
})

const windowsPathTools = {
  delimiter: ';',
  dirname: (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, ''),
  join: (...parts: readonly string[]) => parts.filter(Boolean).join('\\'),
}

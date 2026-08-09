import { parse } from 'smol-toml'

const WINDOWS_CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g

const UNSAFE_PROVIDER_ENV_KEYS = new Set([
  'BASH_ENV',
  'ENV',
  'GCONV_PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'SHELLOPTS',
])

const SAFE_CODEX_ENV_KEYS = [
  'ALL_PROXY',
  'APPDATA',
  'CODEX_ACCESS_TOKEN',
  'CODEX_API_KEY',
  'CODEX_HOME',
  'COLORTERM',
  'ComSpec',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LANGUAGE',
  'LC_ADDRESS',
  'LC_ALL',
  'LC_COLLATE',
  'LC_CTYPE',
  'LC_IDENTIFICATION',
  'LC_MEASUREMENT',
  'LC_MESSAGES',
  'LC_MONETARY',
  'LC_NAME',
  'LC_NUMERIC',
  'LC_PAPER',
  'LC_TELEPHONE',
  'LC_TIME',
  'LOCALAPPDATA',
  'LOGNAME',
  'NO_COLOR',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'SHELL',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'XDG_STATE_HOME',
  'all_proxy',
  'comspec',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const

type CodexFileSystem = {
  readonly existsFile: (filePath: string) => boolean
  readonly readTextFile?: (filePath: string) => string
}

type CodexPathTools = {
  readonly delimiter: string
  readonly dirname: (filePath: string) => string
  readonly join: (...parts: readonly string[]) => string
}

export type CodexSpawnSpecResolverOptions = {
  readonly comspec?: string
  readonly env?: NodeJS.ProcessEnv
  readonly fileSystem?: CodexFileSystem
  readonly pathTools?: CodexPathTools
  readonly platform?: NodeJS.Platform
}

export type CodexResolvedSpawnSpec = {
  readonly args: readonly string[]
  readonly command: string
  readonly env: NodeJS.ProcessEnv
  readonly windowsVerbatimArguments?: boolean
}

export class CodexSpawnSpecResolver {
  resolve(
    argv: readonly string[],
    options: CodexSpawnSpecResolverOptions = {},
  ): CodexResolvedSpawnSpec {
    const [requestedCommand, ...args] = argv
    if (!requestedCommand) {
      throw new Error('Codex command is empty.')
    }

    const platform = options.platform ?? process.platform
    const env = buildCodexEnvironment(options.env ?? process.env, {
      fileSystem: options.fileSystem,
      pathTools: options.pathTools,
      platform,
      requestedCommand,
    })
    const command = resolveCommandPath(requestedCommand, env.PATH, {
      fileSystem: options.fileSystem,
      pathTools: options.pathTools,
      platform,
    })
    if (!command) {
      throw new Error('Codex command could not be resolved.')
    }

    if (platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
      for (const value of [command, ...args]) {
        if (/[\r\n]/.test(value)) {
          throw new Error(
            'Windows command arguments cannot contain line breaks.',
          )
        }
      }
      const shellCommand = [
        escapeWindowsShellCommand(command),
        ...args.map(escapeWindowsCmdShimArgument),
      ].join(' ')

      return {
        args: ['/d', '/s', '/c', `"${shellCommand}"`],
        command: options.comspec ?? env.ComSpec ?? env.comspec ?? 'cmd.exe',
        env,
        windowsVerbatimArguments: true,
      }
    }

    return { args, command, env }
  }
}

function buildCodexEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  options: {
    readonly fileSystem?: CodexFileSystem
    readonly pathTools?: CodexPathTools
    readonly platform: NodeJS.Platform
    readonly requestedCommand: string
  },
): NodeJS.ProcessEnv {
  const pathTools = options.pathTools ?? defaultPathTools(options.platform)
  const pathEntries = [
    ...commonCodexBinaryPaths(baseEnv, options.platform, pathTools),
    ...splitPath(baseEnv.PATH, pathTools.delimiter),
  ]
  const commandDir = commandDirectory(options.requestedCommand, pathTools)

  if (commandDir) {
    pathEntries.unshift(commandDir)
  }

  const pathValue = uniquePathEntries(pathEntries, options.platform).join(
    pathTools.delimiter,
  )

  return {
    ...pickSafeEnvironment(
      baseEnv,
      configuredProviderEnvironmentKeys(baseEnv, options.fileSystem, pathTools),
    ),
    PATH: pathValue,
  }
}

function pickSafeEnvironment(
  env: NodeJS.ProcessEnv,
  additionalKeys: readonly string[],
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    [...SAFE_CODEX_ENV_KEYS, ...additionalKeys].flatMap((key) => {
      const value = env[key]
      return typeof value === 'string' ? [[key, value]] : []
    }),
  )
}

function configuredProviderEnvironmentKeys(
  env: NodeJS.ProcessEnv,
  fileSystem: CodexFileSystem | undefined,
  pathTools: CodexPathTools,
): readonly string[] {
  const home =
    env.CODEX_HOME ??
    ((env.HOME ?? env.USERPROFILE)
      ? pathTools.join(env.HOME ?? env.USERPROFILE ?? '', '.codex')
      : '')

  if (!home || !fileSystem?.readTextFile) {
    return []
  }

  let config: Record<string, unknown>
  try {
    config = parse(
      fileSystem.readTextFile(pathTools.join(home, 'config.toml')),
      {
        integersAsBigInt: 'asNeeded',
      },
    )
  } catch {
    return []
  }

  const providers = config.model_providers
  return isRecord(providers)
    ? Object.values(providers).flatMap((provider) => {
        if (!isRecord(provider) || typeof provider.env_key !== 'string') {
          return []
        }
        const key = provider.env_key
        return isSafeProviderEnvironmentKey(key) ? [key] : []
      })
    : []
}

function isSafeProviderEnvironmentKey(key: string): boolean {
  const normalizedKey = key.toUpperCase()
  return (
    /^[A-Z_][A-Z0-9_]*$/.test(normalizedKey) &&
    !UNSAFE_PROVIDER_ENV_KEYS.has(normalizedKey) &&
    !normalizedKey.startsWith('LD_') &&
    !normalizedKey.startsWith('DYLD_')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveCommandPath(
  command: string,
  pathValue: string | undefined,
  options: {
    readonly fileSystem?: CodexFileSystem
    readonly pathTools?: CodexPathTools
    readonly platform: NodeJS.Platform
  },
): string | null {
  if (isPathLikeCommand(command)) {
    return isExistingFile(command, options.fileSystem) ? command : null
  }

  const pathTools = options.pathTools ?? defaultPathTools(options.platform)
  const candidateNames =
    options.platform === 'win32'
      ? [`${command}.exe`, `${command}.cmd`, command]
      : [command]

  for (const dir of splitPath(pathValue, pathTools.delimiter)) {
    for (const candidateName of candidateNames) {
      const candidate = pathTools.join(dir, candidateName)
      if (isExistingFile(candidate, options.fileSystem)) {
        return candidate
      }
    }
  }

  return null
}

function commonCodexBinaryPaths(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  pathTools: CodexPathTools,
): readonly string[] {
  const home = env.HOME ?? env.USERPROFILE ?? ''

  if (platform === 'win32') {
    return [
      env.APPDATA ? pathTools.join(env.APPDATA, 'npm') : '',
      env.LOCALAPPDATA
        ? pathTools.join(env.LOCALAPPDATA, 'Programs', 'nodejs')
        : '',
      env.ProgramFiles ? pathTools.join(env.ProgramFiles, 'nodejs') : '',
      env['ProgramFiles(x86)']
        ? pathTools.join(env['ProgramFiles(x86)'], 'nodejs')
        : '',
      env.NVM_SYMLINK ?? '',
      env.VOLTA_HOME ? pathTools.join(env.VOLTA_HOME, 'bin') : '',
      home ? pathTools.join(home, '.volta', 'bin') : '',
      home ? pathTools.join(home, '.bun', 'bin') : '',
      home ? pathTools.join(home, '.local', 'bin') : '',
      home ? pathTools.join(home, 'scoop', 'shims') : '',
    ]
  }

  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    env.VOLTA_HOME ? pathTools.join(env.VOLTA_HOME, 'bin') : '',
    env.NVM_BIN ?? '',
    home ? pathTools.join(home, '.local', 'bin') : '',
    home ? pathTools.join(home, '.bun', 'bin') : '',
    home ? pathTools.join(home, '.volta', 'bin') : '',
    home ? pathTools.join(home, '.asdf', 'shims') : '',
  ]
}

function commandDirectory(
  command: string,
  pathTools: CodexPathTools,
): string | null {
  if (!isPathLikeCommand(command)) {
    return null
  }

  return pathTools.dirname(command)
}

function isPathLikeCommand(command: string): boolean {
  return (
    command.includes('/') ||
    command.includes('\\') ||
    /^[A-Za-z]:[\\/]/.test(command)
  )
}

function isExistingFile(
  filePath: string,
  fileSystem: CodexFileSystem | undefined,
): boolean {
  return fileSystem?.existsFile(filePath) ?? false
}

function splitPath(
  pathValue: string | undefined,
  delimiter: string,
): readonly string[] {
  return (pathValue ?? '')
    .split(delimiter)
    .map((entry) => stripSurroundingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0)
}

function uniquePathEntries(
  entries: readonly string[],
  platform: NodeJS.Platform,
): readonly string[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (!entry) {
      return false
    }
    const key = platform === 'win32' ? entry.toLowerCase() : entry
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function stripSurroundingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function defaultPathTools(platform: NodeJS.Platform): CodexPathTools {
  const delimiter = platform === 'win32' ? ';' : ':'
  return {
    delimiter,
    dirname: (filePath) => filePath.replace(/[\\/][^\\/]*$/, ''),
    join: (...parts) =>
      parts.filter(Boolean).join(platform === 'win32' ? '\\' : '/'),
  }
}

function escapeWindowsShellCommand(value: string): string {
  return value.replace(WINDOWS_CMD_META_CHARS, '^$1')
}

function escapeWindowsCmdShimArgument(value: string): string {
  const quotedValue = `"${value
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, '$1$1')}"`

  // npm .cmd shims parse forwarded arguments twice.
  return escapeWindowsShellCommand(escapeWindowsShellCommand(quotedValue))
}

export function buildWindowsSpawnOptions(
  spawnSpec: CodexResolvedSpawnSpec,
): Pick<
  {
    readonly windowsHide?: boolean
    readonly windowsVerbatimArguments?: boolean
  },
  'windowsHide' | 'windowsVerbatimArguments'
> {
  return spawnSpec.windowsVerbatimArguments
    ? { windowsHide: true, windowsVerbatimArguments: true }
    : { windowsHide: true }
}

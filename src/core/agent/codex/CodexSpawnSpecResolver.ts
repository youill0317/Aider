const WINDOWS_CMD_ARGUMENT_CHARS = /[\s"&<>|{}^=;!'+,`~()%@[\]]/u

type CodexFileSystem = {
  readonly existsFile: (filePath: string) => boolean
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
    const command =
      resolveCommandPath(requestedCommand, env.PATH, {
        fileSystem: options.fileSystem,
        pathTools: options.pathTools,
        platform,
      }) ?? requestedCommand

    if (platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
      const shellCommand = [command, ...args]
        .map(quoteWindowsShellArgument)
        .join(' ')

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
    ...baseEnv,
    PATH: pathValue,
  }
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

function quoteWindowsShellArgument(value: string): string {
  if (!value.length) {
    return '""'
  }
  if (!WINDOWS_CMD_ARGUMENT_CHARS.test(value)) {
    return value
  }
  return `"${value.replace(/"/g, '""')}"`
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

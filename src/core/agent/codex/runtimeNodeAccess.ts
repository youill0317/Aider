import type { ChildProcess, SpawnOptions } from 'child_process'

import type { CodexSpawnSpecResolverOptions } from './CodexSpawnSpecResolver'

type ObsidianRuntimeGlobal = typeof globalThis & {
  readonly require?: {
    (moduleName: 'child_process'): typeof import('child_process')
    (moduleName: 'fs'): typeof import('fs')
    (moduleName: 'path'): typeof import('path')
  }
}

export type RuntimeNodeAccess = {
  readonly spawn: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess
  readonly spawnSpecResolverOptions: CodexSpawnSpecResolverOptions
}

export function createRuntimeNodeAccess(): RuntimeNodeAccess {
  const runtimeRequire = (globalThis as ObsidianRuntimeGlobal).require
  if (!runtimeRequire) {
    throw new Error('Codex agent mode requires Obsidian desktop Node access.')
  }
  const { spawn } = runtimeRequire('child_process')
  const fs = runtimeRequire('fs')
  const path = runtimeRequire('path')

  return {
    spawn: (command, args, options) => spawn(command, [...args], options),
    spawnSpecResolverOptions: {
      comspec: process.env.ComSpec ?? process.env.comspec,
      env: process.env,
      fileSystem: {
        existsFile: (filePath) => {
          try {
            return fs.statSync(filePath).isFile()
          } catch {
            return false
          }
        },
      },
      pathTools: {
        delimiter: path.delimiter,
        dirname: (filePath) => path.dirname(filePath),
        join: (...parts) => path.join(...parts),
      },
      platform: process.platform,
    },
  }
}

import type { CodexRuntime } from '../types'

import { CodexAppServerRuntime } from './CodexAppServerRuntime'
import {
  createRuntimeNodeAccess,
  withLoginShellPath,
} from './runtimeNodeAccess'

export async function createCodexRuntime(): Promise<CodexRuntime> {
  const nodeAccess = createRuntimeNodeAccess()
  const spawnSpecResolverOptions = await withLoginShellPath(
    nodeAccess.spawnSpecResolverOptions,
  )

  return new CodexAppServerRuntime({
    spawnSpecResolverOptions,
    spawnProcess: (spawnCommand, args, options) =>
      nodeAccess.spawn(spawnCommand, args, {
        ...options,
        stdio: [...options.stdio],
      }),
  })
}

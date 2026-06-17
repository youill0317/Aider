import { CodexExecRuntime } from './CodexExecRuntime'
import { createRuntimeNodeAccess } from './runtimeNodeAccess'

export async function createCodexExecRuntime(): Promise<CodexExecRuntime> {
  const nodeAccess = createRuntimeNodeAccess()

  return new CodexExecRuntime({
    spawnSpecResolverOptions: nodeAccess.spawnSpecResolverOptions,
    spawnProcess: (command, args, options) =>
      nodeAccess.spawn(command, args, {
        ...options,
        stdio: [...options.stdio],
      }),
  })
}

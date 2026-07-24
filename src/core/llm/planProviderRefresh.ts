import { LLMProvider } from '../../types/provider.types'

type PlanProvider = Extract<
  LLMProvider,
  { type: 'openai-plan' | 'anthropic-plan' | 'gemini-plan' }
>

export type PlanProviderRefreshGuard = {
  providerType: PlanProvider['type']
  refreshToken: string
}

export type PlanProviderUpdateCallback = (
  providerId: string,
  update: Partial<LLMProvider>,
  refreshGuard?: PlanProviderRefreshGuard,
) => void | Promise<void>

const pendingRefreshes = new Map<string, Promise<unknown>>()

export function refreshPlanProviderOnce<T>(
  provider: Pick<PlanProvider, 'id' | 'type'>,
  refreshToken: string,
  refresh: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify([provider.type, provider.id, refreshToken])
  const pending = pendingRefreshes.get(key)
  if (pending) {
    return pending as Promise<T>
  }

  const promise = Promise.resolve().then(refresh)
  pendingRefreshes.set(key, promise)
  const clear = () => {
    if (pendingRefreshes.get(key) === promise) {
      pendingRefreshes.delete(key)
    }
  }
  void promise.then(clear, clear)
  return promise
}
